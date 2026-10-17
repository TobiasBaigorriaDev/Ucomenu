-- SuperAdmin suma una cuenta EXISTENTE como Dueño de otra organización (ficha dueno-existente).
--
-- Una sola puerta de escritura, `admin_add_owner`: solo service_role (la acción de servidor del SuperAdmin) y vuelve a
-- comprobar que el actor es SuperAdmin. No crea, borra ni modifica la cuenta de Auth: solo escribe la membresía y la
-- auditoría, en una transacción. Dos pasos con la misma función:
--   * p_confirmed = false -> no escribe nada: informa si existe la cuenta y en qué locales ya trabaja (para que el
--     SuperAdmin confirme que es la misma persona; ver el riesgo residual de la ficha);
--   * p_confirmed = true  -> suma la membresía 'owner' (o asciende a Personal de esa misma organización) y audita.
-- Devuelve jsonb con `status`: 'no_account' | 'needs_confirmation' | 'already_owner' | 'added' | 'promoted'.
-- Errores: 42501 not_platform_admin · P0002 organization_not_found.
--
-- Rollback (la API de SuperAdmin deja de poder sumar Dueños existentes; las membresías ya creadas se conservan):
--   revoke execute on function public.admin_add_owner(uuid, uuid, text, boolean) from service_role;
--   drop function public.admin_add_owner(uuid, uuid, text, boolean);
--   alter table public.audit_log drop constraint audit_log_action_check;
--   alter table public.audit_log add constraint audit_log_action_check check (action in ('organization.created',
--     'subscription.plan_changed', 'subscription.suspended', 'subscription.reactivated', 'payment.registered'));
--   -- (esto último solo si no hay filas 'owner.added'; si las hay, dejar la restricción nueva.)

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'organization.created',
    'subscription.plan_changed',
    'subscription.suspended',
    'subscription.reactivated',
    'payment.registered',
    'owner.added'
  ));

create function public.admin_add_owner(
  p_actor uuid,
  p_org uuid,
  p_email text,
  p_confirmed boolean
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

  select * into v_current from public.memberships m where m.user_id = v_user and m.organization_id = p_org;
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

  if v_was_member then
    update public.memberships set role = 'owner' where id = v_current.id;
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
comment on function public.admin_add_owner(uuid, uuid, text, boolean) is
  'SuperAdmin suma una cuenta existente como Dueño de una organización (sin tocar la cuenta de Auth), con auditoría. Sin p_confirmed solo informa. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

revoke all on function public.admin_add_owner(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_add_owner(uuid, uuid, text, boolean) to service_role;
