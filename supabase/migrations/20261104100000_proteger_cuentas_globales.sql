-- Cuentas globales de Auth frente a la gestión de personal (nivel C, ficha proteger-cuentas-globales).
--
-- Dos problemas del mismo origen: el Dueño de un local puede cambiar la contraseña o borrar la cuenta de Auth de una
-- persona de su personal, y esa cuenta es GLOBAL (una persona = una cuenta, varias membresías).
--  1. Una cuenta de SuperAdmin (`platform_admins`) nunca se toca desde un local, aunque tenga membresía de Staff.
--  2. «Esta cuenta solo está en mi local» se comprobaba con un SELECT y después se llamaba a la API de Auth (HTTP, fuera de
--     la transacción). Entre las dos cosas, `admin_add_owner` podía sumar la cuenta a otro local: la contraseña se
--     cambiaba o la cuenta se borraba (con sus membresías, en cascada) desde el primero. Repetir el SELECT no cierra esa
--     ventana: hace falta que la comprobación y la operación estén coordinadas.
--
-- Cómo se cierra: una RESERVA (`private.account_leases`) por cuenta, de 2 minutos, que se toma bajo un advisory lock
-- por cuenta junto con la comprobación definitiva. Quien suma una membresía (trigger BEFORE INSERT y `admin_add_owner`)
-- toma el MISMO lock y se niega (`account_busy`, 55006) mientras haya una reserva vigente. Resultado: o la membresía nueva
-- se confirma antes (y la comprobación posterior ve «cuenta compartida» y no hace nada global), o la reserva se toma antes
-- (y la membresía nueva espera y es rechazada). No hay un tercer orden. La reserva vence sola si el servidor muere
-- entre la reserva y la llamada a Auth; se libera con `personnel_end_operation`, y borrar la cuenta la elimina en cascada.
--
-- Funciones (solo service_role; vuelven a comprobar que quien pide es Dueño de la organización):
--  * personnel_begin_reset(actor, org, membership)  -> jsonb {status, user_id, token}
--      status: ok | not_found | self | owner_target | platform_admin | shared_account | busy
--  * personnel_remove_member(actor, org, membership) -> jsonb {status, delete_account, user_id, token, reason}
--      Quita la membresía y, SOLO si la cuenta quedó sin ninguna y no es de un SuperAdmin, reserva su borrado.
--  * personnel_end_operation(user, token)           -> libera la reserva propia.
--
-- `platform_admins.user_id` conserva ON DELETE CASCADE (borrar la cuenta de un SuperAdmin como operador sigue funcionando; ver
-- admin.rls.test.ts). La defensa está en los dos únicos caminos de la aplicación que cambian o borran una cuenta de Auth.
--
-- Rollback (local: git revert + `pnpm db:reset`). En una base con datos:
--   drop trigger memberships_account_lease on public.memberships;
--   drop function public.personnel_begin_reset(uuid, uuid, uuid), public.personnel_remove_member(uuid, uuid, uuid),
--     public.personnel_end_operation(uuid, uuid);
--   drop function private.memberships_account_lease(), private.assert_account_free(uuid);
--   drop table private.account_leases;
--   -- y restaurar `admin_add_owner` de 20261024100000_sumar_dueno_existente.sql (sin la llamada a assert_account_free).

create table private.account_leases (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  purpose text not null check (purpose in ('password_reset', 'account_delete')),
  expires_at timestamptz not null
);
comment on table private.account_leases is
  'Reserva de una cuenta de Auth mientras un servidor le cambia la contraseña o la borra. Vence sola. Ver 20261104100000.';
revoke all on table private.account_leases from public, anon, authenticated, service_role;

-- Toma el lock de la cuenta (hasta el fin de la transacción) y falla si hay una reserva vigente.
create function private.assert_account_free(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('account:' || p_user::text, 0));
  if exists (select 1 from private.account_leases l where l.user_id = p_user and l.expires_at > clock_timestamp()) then
    raise exception 'account_busy' using errcode = '55006';
  end if;
end;
$$;
revoke all on function private.assert_account_free(uuid) from public, anon, authenticated;

-- Ninguna membresía nueva (de ningún camino, service_role incluido) entra a una cuenta reservada.
create function private.memberships_account_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_account_free(new.user_id);
  return new;
end;
$$;
revoke all on function private.memberships_account_lease() from public, anon, authenticated;

create trigger memberships_account_lease
  before insert on public.memberships
  for each row execute function private.memberships_account_lease();

-- ---------------------------------------------------------------------------
-- Restablecer la contraseña de una persona del personal
-- ---------------------------------------------------------------------------

create function public.personnel_begin_reset(p_actor uuid, p_org uuid, p_membership uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_role text;
  v_token uuid;
begin
  if p_actor is null or not exists (
    select 1 from public.memberships m where m.user_id = p_actor and m.organization_id = p_org and m.role = 'owner'
  ) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select m.user_id into v_user from public.memberships m where m.id = p_membership and m.organization_id = p_org;
  if v_user is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Con el lock de la cuenta se vuelve a leer todo: lo que sigue es lo definitivo.
  perform pg_advisory_xact_lock(hashtextextended('account:' || v_user::text, 0));

  select m.role into v_role from public.memberships m where m.id = p_membership and m.organization_id = p_org;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_user = p_actor then
    return jsonb_build_object('status', 'self');
  end if;
  if v_role = 'owner' then
    return jsonb_build_object('status', 'owner_target');
  end if;
  if exists (select 1 from public.platform_admins a where a.user_id = v_user) then
    return jsonb_build_object('status', 'platform_admin');
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_user and m.organization_id <> p_org) then
    return jsonb_build_object('status', 'shared_account');
  end if;
  if exists (select 1 from private.account_leases l where l.user_id = v_user and l.expires_at > clock_timestamp()) then
    return jsonb_build_object('status', 'busy');
  end if;

  insert into private.account_leases as l (user_id, purpose, expires_at)
  values (v_user, 'password_reset', clock_timestamp() + interval '2 minutes')
  on conflict (user_id) do update
    set token = gen_random_uuid(), purpose = excluded.purpose, expires_at = excluded.expires_at
  returning l.token into v_token;

  return jsonb_build_object('status', 'ok', 'user_id', v_user, 'token', v_token);
end;
$$;
comment on function public.personnel_begin_reset(uuid, uuid, uuid) is
  'Reserva la cuenta de una persona del personal para cambiarle la contraseña. Rechaza SuperAdmin, cuentas con otra membresía, Dueños y a uno mismo. Solo service_role; vuelve a comprobar que p_actor es Dueño.';

-- ---------------------------------------------------------------------------
-- Quitar a una persona del personal (y su cuenta, si ya no sirve)
-- ---------------------------------------------------------------------------

create function public.personnel_remove_member(p_actor uuid, p_org uuid, p_membership uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_token uuid;
begin
  if p_actor is null or not exists (
    select 1 from public.memberships m where m.user_id = p_actor and m.organization_id = p_org and m.role = 'owner'
  ) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select m.user_id into v_user from public.memberships m where m.id = p_membership and m.organization_id = p_org;
  if v_user is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_user = p_actor then
    return jsonb_build_object('status', 'self');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account:' || v_user::text, 0));

  -- Puede fallar con 23514 `last_owner_required` (invariante de la base): se propaga y no se quita nada.
  delete from public.memberships m where m.id = p_membership and m.organization_id = p_org;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if exists (select 1 from public.memberships m where m.user_id = v_user) then
    return jsonb_build_object('status', 'removed', 'delete_account', false, 'reason', 'other_membership');
  end if;
  if exists (select 1 from public.platform_admins a where a.user_id = v_user) then
    return jsonb_build_object('status', 'removed', 'delete_account', false, 'reason', 'platform_admin');
  end if;
  if exists (select 1 from private.account_leases l where l.user_id = v_user and l.expires_at > clock_timestamp()) then
    -- Otra operación global sobre la cuenta está en curso: no se pisa. La cuenta queda sin local (inofensiva) y se avisa.
    return jsonb_build_object('status', 'removed', 'delete_account', false, 'reason', 'busy');
  end if;

  insert into private.account_leases as l (user_id, purpose, expires_at)
  values (v_user, 'account_delete', clock_timestamp() + interval '2 minutes')
  on conflict (user_id) do update
    set token = gen_random_uuid(), purpose = excluded.purpose, expires_at = excluded.expires_at
  returning l.token into v_token;

  return jsonb_build_object('status', 'removed', 'delete_account', true, 'user_id', v_user, 'token', v_token);
end;
$$;
comment on function public.personnel_remove_member(uuid, uuid, uuid) is
  'Quita una membresía y, si la cuenta quedó sin ninguna y no es de un SuperAdmin, reserva su borrado de Auth. Solo service_role; vuelve a comprobar que p_actor es Dueño.';

create function public.personnel_end_operation(p_user uuid, p_token uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.account_leases l where l.user_id = p_user and l.token = p_token;
$$;
comment on function public.personnel_end_operation(uuid, uuid) is
  'Libera la reserva de una cuenta tomada por personnel_begin_reset o personnel_remove_member. Solo service_role.';

revoke all on function public.personnel_begin_reset(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.personnel_remove_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.personnel_end_operation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.personnel_begin_reset(uuid, uuid, uuid) to service_role;
grant execute on function public.personnel_remove_member(uuid, uuid, uuid) to service_role;
grant execute on function public.personnel_end_operation(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_add_owner: respeta la reserva (también al ascender una membresía existente, que el trigger de INSERT no ve)
-- ---------------------------------------------------------------------------

create or replace function public.admin_add_owner(
  p_actor uuid,
  p_org uuid,
  p_email text,
  p_confirmed boolean,
  p_expected_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_slug text;
  v_user uuid;
  v_current public.memberships%rowtype;
  v_others jsonb;
  v_was_member boolean;
  v_rows integer;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then
    return jsonb_build_object('status', 'no_account');
  end if;

  -- Serializa los pedidos sobre la misma cuenta y organización (doble envío, dos SuperAdmin a la vez).
  perform pg_advisory_xact_lock(hashtextextended('add-owner:' || p_org::text || ':' || v_user::text, 0));

  -- Dónde trabaja la cuenta hoy (en el resto de los locales; solo nombre, identificador y rol).
  select coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'slug', o.slug, 'role', m.role) order by o.name), '[]'::jsonb)
    into v_others
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_user and m.organization_id <> p_org;

  -- FOR UPDATE: si otra transacción está borrando o cambiando esta membresía, se espera a que termine y se lee el estado
  -- real (sin esto el ascenso podía actualizar 0 filas y aun así auditar «promoted»).
  select * into v_current from public.memberships m where m.user_id = v_user and m.organization_id = p_org for update;
  v_was_member := found;
  if v_was_member and v_current.role = 'owner' then
    return jsonb_build_object('status', 'already_owner', 'user_id', v_user, 'others', v_others);
  end if;

  if not coalesce(p_confirmed, false) then
    return jsonb_build_object(
      'status', 'needs_confirmation',
      'user_id', v_user,
      'current_role', case when v_was_member then v_current.role end,
      'others', v_others
    );
  end if;

  -- La confirmación vale para la cuenta que se mostró, no para lo que hoy resuelva el email.
  if p_expected_user is null or p_expected_user is distinct from v_user then
    raise exception 'account_changed' using errcode = '55000';
  end if;

  -- Un servidor puede estar cambiándole la contraseña o borrando esta cuenta (reserva vigente): no se suma ahora.
  -- Toma el lock de la cuenta, así que lo que se escribe a continuación queda ordenado respecto de esa operación.
  perform private.assert_account_free(v_user);

  if v_was_member then
    update public.memberships set role = 'owner' where id = v_current.id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'membership_changed' using errcode = '55000';
    end if;
  else
    insert into public.memberships (user_id, organization_id, role) values (v_user, p_org, 'owner');
  end if;

  select u.email into v_actor_email from auth.users u where u.id = p_actor;
  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'owner.added',
    p_org,
    -- Sin emails de terceros: solo identificadores de locales y roles.
    jsonb_build_object(
      'role_here', case when v_was_member then v_current.role end,
      'elsewhere', (select coalesce(jsonb_agg(jsonb_build_object('slug', e->>'slug', 'role', e->>'role')), '[]'::jsonb) from jsonb_array_elements(v_others) e)
    ),
    jsonb_build_object('slug', v_slug, 'owner_user_id', v_user, 'promoted', v_was_member)
  );

  return jsonb_build_object('status', case when v_was_member then 'promoted' else 'added' end, 'user_id', v_user, 'others', v_others);
end;
$$;
