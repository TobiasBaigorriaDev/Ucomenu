-- Cuentas de Auth sin ningún local: listarlas y borrarlas a mano desde SuperAdmin (nivel C). Ficha: agile/cambios/cuentas-sin-local.md.
--
-- Al borrar una organización (ADR 0028) sus membresías se van en cascada y las cuentas de su personal quedan en Auth sin ningún local.
-- Se conservan (nunca se borra una cuenta sola). Esto da al SuperAdmin una lista de esas cuentas y un borrado manual, con el
-- email escrito, el motivo y una constancia en la auditoría. Aditiva: una acción nueva en `audit_log` y tres funciones.
--
-- Funciones (solo service_role; vuelven a comprobar que `p_actor` es SuperAdmin):
--  * admin_list_orphan_accounts(actor)                      -> jsonb [{user_id, email, created_at, last_sign_in_at}] (hasta 100)
--  * admin_begin_orphan_delete(actor, user, email, reason)  -> jsonb {status, token}
--      status: ok | not_found | email_mismatch | invalid_reason | platform_admin | has_membership | too_recent | busy
--      Comprueba todo bajo el MISMO lock por cuenta que usan las membresías nuevas (ADR 0032) y toma la reserva de 2 minutos:
--      mientras dure, nadie suma una membresía a la cuenta (`account_busy`); si la sumaron antes, no se borra.
--  * admin_record_account_deleted(actor, user, reason)      -> audita 'account.deleted' una vez que la cuenta ya no existe.
--
-- Una cuenta solo es «sin local» si no tiene membresías, no es de un SuperAdmin y tiene más de 1 hora: el alta de una organización
-- crea primero la cuenta y después la membresía, y en esa ventana la cuenta nueva no puede aparecer como borrable.
-- La auditoría guarda el id de la cuenta y el motivo, nunca el email (convención de `audit_log`: sin datos de terceros).
--
-- Rollback (local: git revert + `pnpm db:reset`). En una base con datos, en UNA transacción:
--   drop function public.admin_list_orphan_accounts(uuid), public.admin_begin_orphan_delete(uuid, uuid, text, text),
--     public.admin_record_account_deleted(uuid, uuid, text);
--   y volver a aplicar `audit_log_action_check` con la lista de 20261102100000_borrado_de_organizaciones.sql
--   (falla si ya hay movimientos 'account.deleted': habría que conservarlos).

begin;

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
    'organization.deleted',
    'account.deleted'
  ));

create function public.admin_list_orphan_accounts(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', o.id, 'email', o.email, 'created_at', o.created_at, 'last_sign_in_at', o.last_sign_in_at
    ) order by o.created_at desc)
    from (
      select u.id, u.email, u.created_at, u.last_sign_in_at
      from auth.users u
      where not exists (select 1 from public.memberships m where m.user_id = u.id)
        and not exists (select 1 from public.platform_admins a where a.user_id = u.id)
        and not exists (select 1 from private.account_leases l where l.user_id = u.id and l.expires_at > clock_timestamp())
        and u.created_at < clock_timestamp() - interval '1 hour'
      order by u.created_at desc
      limit 100
    ) o
  ), '[]'::jsonb);
end;
$$;
comment on function public.admin_list_orphan_accounts(uuid) is
  'Cuentas de Auth sin membresías, que no son de un SuperAdmin y tienen más de 1 hora (hasta 100). Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

create function public.admin_begin_orphan_delete(p_actor uuid, p_user uuid, p_email text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_created timestamptz;
  v_token uuid;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200 then
    return jsonb_build_object('status', 'invalid_reason');
  end if;

  -- Con el lock de la cuenta se lee todo de nuevo: lo que sigue es lo definitivo (quien suma membresías toma el mismo lock).
  perform pg_advisory_xact_lock(hashtextextended('account:' || coalesce(p_user::text, ''), 0));

  select u.email, u.created_at into v_email, v_created from auth.users u where u.id = p_user;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if lower(btrim(coalesce(p_email, ''))) is distinct from lower(coalesce(v_email, '')) then
    return jsonb_build_object('status', 'email_mismatch');
  end if;
  if exists (select 1 from public.platform_admins a where a.user_id = p_user) then
    return jsonb_build_object('status', 'platform_admin');
  end if;
  if exists (select 1 from public.memberships m where m.user_id = p_user) then
    return jsonb_build_object('status', 'has_membership');
  end if;
  if v_created >= clock_timestamp() - interval '1 hour' then
    return jsonb_build_object('status', 'too_recent');
  end if;
  if exists (select 1 from private.account_leases l where l.user_id = p_user and l.expires_at > clock_timestamp()) then
    return jsonb_build_object('status', 'busy');
  end if;

  insert into private.account_leases as l (user_id, purpose, expires_at)
  values (p_user, 'account_delete', clock_timestamp() + interval '2 minutes')
  on conflict (user_id) do update
    set token = gen_random_uuid(), purpose = excluded.purpose, expires_at = excluded.expires_at
  returning l.token into v_token;

  return jsonb_build_object('status', 'ok', 'token', v_token);
end;
$$;
comment on function public.admin_begin_orphan_delete(uuid, uuid, text, text) is
  'Reserva una cuenta sin local para borrarla de Auth: exige el email escrito, el motivo y que no tenga membresías, no sea de un SuperAdmin y tenga más de 1 hora. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

create function public.admin_record_account_deleted(p_actor uuid, p_user uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if p_user is null or p_reason is null or char_length(btrim(p_reason)) not between 1 and 200 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  -- Solo se audita un borrado que ya ocurrió.
  if exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'account_still_exists' using errcode = '55000';
  end if;
  if exists (select 1 from public.audit_log l where l.action = 'account.deleted' and l.before ->> 'user_id' = p_user::text) then
    return jsonb_build_object('status', 'already_recorded');
  end if;

  select u.email into v_actor_email from auth.users u where u.id = p_actor;
  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'account.deleted',
    null,
    -- Sin el email de la cuenta borrada: solo su identificador.
    jsonb_build_object('user_id', p_user),
    jsonb_build_object('user_id', p_user, 'reason', btrim(p_reason))
  );
  return jsonb_build_object('status', 'recorded');
end;
$$;
comment on function public.admin_record_account_deleted(uuid, uuid, text) is
  'Audita el borrado de una cuenta sin local una vez que ya no existe en Auth. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

revoke all on function public.admin_list_orphan_accounts(uuid) from public, anon, authenticated;
revoke all on function public.admin_begin_orphan_delete(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_record_account_deleted(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_list_orphan_accounts(uuid) to service_role;
grant execute on function public.admin_begin_orphan_delete(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_record_account_deleted(uuid, uuid, text) to service_role;

commit;
