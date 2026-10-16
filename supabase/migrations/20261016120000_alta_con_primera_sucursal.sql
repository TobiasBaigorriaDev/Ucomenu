-- SuperAdmin: el alta de una organización crea también su primera sucursal (ficha agile/cambios/alta-con-primera-sucursal.md).
--
-- Reemplaza `admin_create_organization` por una versión con dos parámetros opcionales al final (`p_branch_slug`,
-- `p_branch_name`). Con ambos, la sucursal se crea en la MISMA transacción que la organización, el Dueño y la auditoría;
-- con ninguno, el comportamiento es el de antes (sin sucursal). Uno solo de los dos es un error (22023 invalid_branch).
-- Todo lo demás de la función (comprobar al SuperAdmin, período, plan, auditoría) queda igual.
--
-- La sucursal pasa por el trigger de límites: el plan decide si entra (todos los planes admiten al menos una).
-- Permisos: igual que la versión anterior, solo service_role. Se parte de cero porque PUBLIC recibe EXECUTE al crear.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop function public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz, text, text);
--   y volver a crear la función con la definición de 20261014210000_superadmin_alta_de_organizaciones.sql.
--   Las sucursales ya creadas quedan intactas.

drop function public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz);

create function public.admin_create_organization(
  p_actor uuid,
  p_slug text,
  p_name text,
  p_owner uuid,
  p_plan text,
  p_billing_cycle text,
  p_period_end timestamptz,
  p_branch_slug text default null,
  p_branch_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_org_id uuid;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  if p_period_end is null or p_period_end <= now() or p_period_end > now() + interval '731 days' then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  if not exists (select 1 from public.plans p where p.code = p_plan) then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  -- Sucursal: las dos cosas o ninguna.
  if (p_branch_slug is null) <> (p_branch_name is null) then
    raise exception 'invalid_branch' using errcode = '22023';
  end if;

  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  insert into public.organizations (slug, name)
  values (p_slug, p_name)
  returning id into v_org_id;

  -- La suscripción de prueba ya la creó el trigger de organizations.
  update public.subscriptions
  set plan_code = p_plan,
      billing_cycle = p_billing_cycle,
      current_period_end = p_period_end,
      trial_ends_at = null
  where organization_id = v_org_id;
  if not found then
    raise exception 'subscription_missing' using errcode = 'XX000';
  end if;

  insert into public.memberships (user_id, organization_id, role)
  values (p_owner, v_org_id, 'owner');

  -- Después del plan: el trigger de límites ya ve el plan elegido. Slug y nombre inválidos dan 23514 (check de la tabla).
  if p_branch_slug is not null then
    insert into public.branches (organization_id, slug, name)
    values (v_org_id, p_branch_slug, p_branch_name);
  end if;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'organization.created',
    v_org_id,
    null,
    jsonb_build_object(
      'slug', p_slug,
      'name', p_name,
      'plan', p_plan,
      'billing_cycle', p_billing_cycle,
      'period_end', p_period_end,
      'owner_user_id', p_owner
    ) || case
      when p_branch_slug is null then '{}'::jsonb
      else jsonb_build_object('branch', jsonb_build_object('slug', p_branch_slug, 'name', p_branch_name))
    end
  );

  return v_org_id;
end;
$$;
comment on function public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz, text, text) is
  'Alta de organización con Dueño, plan, primera sucursal (opcional) y auditoría en una transacción. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

revoke all on function
  public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz, text, text)
from public, anon, authenticated;

grant execute on function
  public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz, text, text)
to service_role;
