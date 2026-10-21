-- Retención y purga de `payments` y `payment_voids` (nivel C: dinero + eliminación irreversible).
-- Ficha: agile/cambios/retencion-de-pagos.md · ADR 0027 (política) sobre ADR 0013 y 0024 (las tablas) y ADR 0026 (price_history).
--
-- Dos cambios:
--  (1) Se quitan las claves foráneas `ON DELETE RESTRICT` de `payments` y `payment_voids` hacia `organizations` y
--      `subscriptions`: los pagos SOBREVIVEN al borrado de la organización (son la contabilidad de UcoMenu; no tienen datos
--      personales del cliente). Se conserva `payment_voids.payment_id → payments`: una anulación nunca queda sin su pago.
--  (2) `private.purge_expired_payments(p_actor, p_reason)`: borra los pagos (y sus anulaciones) de organizaciones que YA NO
--      EXISTEN y que se registraron hace más de 10 años, y deja una auditoría `payments.purged`. Se amplía el `check` de
--      `audit_log.action`.
--
-- Política (usuario, 2026-10-20): los pagos se conservan 10 años desde su registro (plazo habitual de los registros contables
-- en Argentina; a confirmar con el contador antes de producción); pasado ese plazo, y solo si la organización ya fue borrada,
-- se pueden purgar. Los pagos de una organización que existe (aun dada de baja) NO se purgan nunca, por antiguos que sean.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop function private.purge_expired_payments(uuid, text);
--   y, SOLO si no hay pagos huérfanos (de organizaciones borradas), volver a crear las cuatro claves foráneas con
--   `on delete restrict` (payments_organization_id_fkey, payments_subscription_id_fkey, payment_voids_organization_id_fkey,
--   payment_voids_subscription_id_fkey). Con pagos huérfanos no se pueden recrear: eso es justamente lo que se quiere conservar.
--   La auditoría queda; mientras existan filas `payments.purged` no se puede volver a poner el `check` viejo.
--
-- Cómo se apaga el trigger de solo-agregado, a propósito y sin dejarlo apagado: igual que en la purga de `price_history`
-- (ADR 0026). Función `SECURITY DEFINER` de `postgres`, `search_path` vacío, sin EXECUTE para NINGÚN rol de la API; los
-- `alter table … disable trigger` son transaccionales (si algo falla después o se revierte, vuelven a estar encendidos y las
-- filas siguen). Toman SHARE ROW EXCLUSIVE: los pagos esperan, un instante, a que termine. El trigger de TRUNCATE no se toca.
-- Se llama a mano como `postgres` con aprobación humana, indicando un SuperAdmin como responsable y el motivo.
--
-- Errores estables: not_platform_admin (42501) · invalid_reason (22023).

-- ---------------------------------------------------------------------------
-- (1) Los pagos sobreviven al borrado de la organización
-- ---------------------------------------------------------------------------
-- Quedan `organization_id` y `subscription_id` como ids sin clave foránea (como `audit_log`). Las escribe solo la función
-- que registra el pago, desde la suscripción bloqueada, así que son coherentes de origen; los UUID no se reutilizan.

alter table public.payments drop constraint payments_organization_id_fkey;
alter table public.payments drop constraint payments_subscription_id_fkey;
alter table public.payment_voids drop constraint payment_voids_organization_id_fkey;
alter table public.payment_voids drop constraint payment_voids_subscription_id_fkey;

comment on column public.payments.organization_id is
  'Organización del pago. Sin clave foránea a propósito: el pago sobrevive al borrado de la organización (ADR 0027).';
comment on column public.payments.subscription_id is
  'Suscripción del pago. Sin clave foránea a propósito: sobrevive al borrado de la organización (ADR 0027).';
comment on column public.payment_voids.organization_id is
  'Organización del pago anulado. Sin clave foránea a propósito: sobrevive al borrado de la organización (ADR 0027).';
comment on column public.payment_voids.subscription_id is
  'Suscripción del pago anulado. Sin clave foránea a propósito: sobrevive al borrado de la organización (ADR 0027).';

-- ---------------------------------------------------------------------------
-- Auditoría: acción nueva
-- ---------------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'organization.created',
    'subscription.plan_changed',
    'subscription.suspended',
    'subscription.reactivated',
    'payment.registered',
    'payment.voided',
    'owner.added',
    'organization.deactivated',
    'organization.reactivated',
    'addon.activated',
    'addon.changed',
    'addon.ended',
    'payments.purged'
  ));

-- ---------------------------------------------------------------------------
-- (2) Purga por vencimiento del plazo
-- ---------------------------------------------------------------------------

create function private.purge_expired_payments(p_actor uuid, p_reason text)
returns table (payments_purged integer, voids_purged integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_reason text;
  v_cutoff timestamptz;
  v_payments integer;
  v_voids integer;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  -- Los locks de las dos tablas se toman acá: nadie registra ni anula un pago hasta que esta transacción termine.
  alter table public.payments disable trigger payments_no_update_delete;
  alter table public.payment_voids disable trigger payment_voids_no_update_delete;

  -- clock_timestamp(): el instante real tras los locks, no el inicio de la transacción (que pudo esperar).
  v_cutoff := clock_timestamp() - interval '10 years';

  -- Primero las anulaciones de los pagos que se van (payment_voids → payments sigue con RESTRICT).
  delete from public.payment_voids v
  using public.payments p
  where p.id = v.payment_id
    and p.created_at < v_cutoff
    and not exists (select 1 from public.organizations o where o.id = p.organization_id);
  get diagnostics v_voids = row_count;

  delete from public.payments p
  where p.created_at < v_cutoff
    and not exists (select 1 from public.organizations o where o.id = p.organization_id);
  get diagnostics v_payments = row_count;

  alter table public.payments enable trigger payments_no_update_delete;
  alter table public.payment_voids enable trigger payment_voids_no_update_delete;

  -- Sin nada que purgar no se deja auditoría (como un "sin cambios" en las demás acciones).
  if v_payments > 0 then
    select u.email into v_actor_email from auth.users u where u.id = p_actor;
    insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
    values (
      p_actor,
      coalesce(v_actor_email, '(sin email)'),
      'payments.purged',
      null,
      null,
      jsonb_build_object('payments', v_payments, 'voids', v_voids, 'registered_before', v_cutoff, 'years', 10, 'reason', v_reason)
    );
  end if;

  return query select v_payments, v_voids;
end;
$$;
comment on function private.purge_expired_payments(uuid, text) is
  'Purga los pagos (y sus anulaciones) de organizaciones ya borradas, registrados hace más de 10 años, con auditoría. Apaga los triggers de solo-agregado dentro de la transacción. Sin EXECUTE para ningún rol de la API (ADR 0027).';

revoke all on function private.purge_expired_payments(uuid, text) from public, anon, authenticated, service_role;
