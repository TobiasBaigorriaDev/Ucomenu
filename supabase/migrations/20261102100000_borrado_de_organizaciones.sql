-- SuperAdmin: borrado definitivo de una organización (nivel C: eliminación irreversible).
-- Ficha: agile/cambios/borrado-de-organizaciones.md · ADR 0028 (la acción) sobre ADR 0025 (baja), 0026 (price_history) y
-- 0027 (pagos).
--
-- UNA función de API que solo ejecuta service_role: `admin_delete_organization(actor, org, slug, reason)`. Todo en una
-- sola transacción: recomprueba que `p_actor` es SuperAdmin, exige el motivo y el slug escrito, toma los locks, llama a
-- `private.purge_organization_price_history` (que exige la baja auditada de 30 días o más), borra la organización (la
-- cascada se lleva sucursales, carta, mesas, suscripción, membresías…) y deja la auditoría `organization.deleted` con el
-- slug y el nombre (con eso se identifican los pagos huérfanos, que se conservan: ADR 0027).
--
-- Aditiva: una función nueva y el `check` de `audit_log.action` ampliado. No cambia tablas, triggers ni permisos de nada.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos: `drop function
-- public.admin_delete_organization(uuid, uuid, text, text)`. Las organizaciones ya borradas no vuelven (solo el respaldo de
-- docs/operacion.md); mientras existan filas `organization.deleted` no se puede volver a poner el `check` viejo.
--
-- Lo que NO hace (a propósito): no toca los archivos de Storage (la aplicación los borra por la API de Storage después de
-- confirmar esta transacción; ver la ficha), no borra las cuentas de Auth del Dueño ni del Staff (una cuenta puede tener
-- otros locales) y no toca los pagos ni sus anulaciones (ADR 0027).
--
-- Errores estables (mensaje = nombre que lee el servidor):
--   42501 not_platform_admin · 22023 invalid_reason / slug_mismatch · P0002 organization_not_found ·
--   55000 organization_still_active / deactivation_not_audited / deactivation_too_recent (de la purga de price_history).

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
    'payments.purged',
    'organization.deleted'
  ));

-- ---------------------------------------------------------------------------
-- La acción
-- ---------------------------------------------------------------------------

create function public.admin_delete_organization(
  p_actor uuid,
  p_org uuid,
  p_slug text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_reason text;
  v_org public.organizations%rowtype;
  v_purged integer;
  v_branches integer;
  v_products integer;
  v_memberships integer;
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

  -- Mismo orden de locks que las demás acciones: primero la suscripción (serializa pagos y add-ons), después la organización.
  -- FOR UPDATE en la organización: choca con el NO KEY UPDATE de la baja/reactivación y con el de la purga de price_history, así
  -- que una reactivación en vuelo termina antes de esta comprobación o espera a que termine esta transacción.
  perform 1 from public.subscriptions s where s.organization_id = p_org for update;
  select * into v_org from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;

  -- El slug escrito por la persona tiene que ser el de ESTA organización (la confirmación del borrado).
  if p_slug is null or p_slug <> v_org.slug then
    raise exception 'slug_mismatch' using errcode = '22023';
  end if;

  -- Baja auditada de 30 días o más (lo comprueba la purga: organization_still_active, deactivation_not_audited,
  -- deactivation_too_recent). Si falla, no se borró nada.
  v_purged := private.purge_organization_price_history(p_org);

  -- Lo que se va con la organización y lo que se conserva, para dejarlo en la auditoría.
  select count(*) into v_branches from public.branches b where b.organization_id = p_org;
  select count(*) into v_products from public.products p where p.organization_id = p_org;
  select count(*) into v_memberships from public.memberships m where m.organization_id = p_org;
  select count(*) into v_payments from public.payments p where p.organization_id = p_org;
  select count(*) into v_voids from public.payment_voids v where v.organization_id = p_org;

  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  delete from public.organizations where id = v_org.id;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'organization.deleted',
    v_org.id,
    jsonb_build_object('slug', v_org.slug, 'name', v_org.name, 'active', v_org.is_active),
    jsonb_build_object(
      'slug', v_org.slug,
      'name', v_org.name,
      'reason', v_reason,
      'price_history_purged', v_purged,
      'branches', v_branches,
      'products', v_products,
      'memberships', v_memberships,
      'payments_kept', v_payments,
      'voids_kept', v_voids
    )
  );

  return jsonb_build_object('price_history_purged', v_purged, 'payments_kept', v_payments);
end;
$$;
comment on function public.admin_delete_organization(uuid, uuid, text, text) is
  'Borra definitivamente una organización dada de baja hace 30 días o más: purga su historial de precios, la borra y audita (slug y nombre). Conserva los pagos (ADR 0027). Solo service_role; vuelve a comprobar que p_actor es SuperAdmin y que p_slug es el de la organización.';

-- PUBLIC recibe EXECUTE por defecto: se parte de cero. Solo la ejecuta service_role (el servidor).
revoke all on function public.admin_delete_organization(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_organization(uuid, uuid, text, text) to service_role;
