-- Cuentas creadas por un Dueño no abren locales (ficha cuentas-creadas-por-duenos; hallazgos de la auditoría run-2, 2026-11-07).
-- `createMember` crea cuentas del personal con `email_confirm: true` para cualquier correo: el correo figura confirmado sin que nadie
-- haya probado el buzón. La app las marca con `app_metadata.mailbox = 'unverified'` (solo la clave de servicio escribe ese campo) y esta
-- función rechaza esa marca, para que no sirvan de «email confirmado» al pedir la prueba gratis. La app cambia la marca a `verified` cuando
-- la persona prueba su correo con un enlace o con Google. Las cuentas anteriores a esta migración no llevan marca y siguen igual.
-- Reversión: volver a crear la función con la definición de 20261218100000_registro_autoservicio.sql (sin la condición de `mailbox`).
create or replace function public.self_register_organization(
  p_user uuid,
  p_slug text,
  p_name text,
  p_branch_slug text,
  p_branch_name text,
  p_terms_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_hash text;
  v_org_id uuid;
begin
  -- La confirmación se lee de Auth: ni el formulario ni el JWT deciden.
  select u.email into v_email
  from auth.users u
  where u.id = p_user and u.email_confirmed_at is not null and u.deleted_at is null and u.banned_until is null
    -- Una cuenta que creó un Dueño (`mailbox = unverified`) tiene el email «confirmado» sin que nadie probara el buzón: no abre locales.
    and coalesce(u.raw_app_meta_data ->> 'mailbox', '') <> 'unverified';
  if v_email is null then
    raise exception 'email_not_confirmed' using errcode = '42501';
  end if;

  if p_terms_version is null or char_length(p_terms_version) not between 1 and 40 then
    raise exception 'invalid_terms' using errcode = '22023';
  end if;
  if lower(coalesce(p_slug, '')) in ('admin', 'api', 'ayuda', 'demo', 'soporte', 'ucomenu', 'uconext', 'www') then
    raise exception 'slug_reserved' using errcode = '22023';
  end if;

  -- Las altas propias van de a una: así no se cuela nadie por encima del tope de abajo, y dos pedidos del mismo buzón se ordenan.
  -- Duran milisegundos y el tope las limita a 30 por hora: la fila no molesta.
  v_hash := private.normalized_email_hash(v_email);
  perform pg_advisory_xact_lock(hashtextextended('self_register', 0));

  if exists (select 1 from public.memberships m where m.user_id = p_user and m.role = 'owner') then
    raise exception 'already_owner' using errcode = '55000';
  end if;
  if exists (select 1 from public.trial_claims c where c.email_hash = v_hash) then
    raise exception 'trial_already_used' using errcode = '55000';
  end if;
  -- Cortacircuitos ante una ola de altas: el tope es global y se sube con una migración.
  if (
    select count(*) from public.organizations o
    where o.origin = 'self_service' and o.created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'signups_throttled' using errcode = '55000';
  end if;

  insert into public.trial_claims (email_hash, terms_version) values (v_hash, p_terms_version);

  insert into public.organizations (slug, name, origin)
  values (p_slug, p_name, 'self_service')
  returning id into v_org_id;

  -- La suscripción de prueba (14 días) ya la creó el trigger de organizations; la portada promete Pro.
  update public.subscriptions set plan_code = 'pro' where organization_id = v_org_id;
  if not found then
    raise exception 'subscription_missing' using errcode = 'XX000';
  end if;

  insert into public.memberships (user_id, organization_id, role) values (p_user, v_org_id, 'owner');

  insert into public.branches (organization_id, slug, name) values (v_org_id, p_branch_slug, p_branch_name);

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_user,
    v_email,
    'organization.self_registered',
    v_org_id,
    null,
    jsonb_build_object(
      'slug', p_slug,
      'name', p_name,
      'plan', 'pro',
      'owner_user_id', p_user,
      'terms_version', p_terms_version,
      'branch', jsonb_build_object('slug', p_branch_slug, 'name', p_branch_name)
    )
  );

  return v_org_id;
end;
$$;
comment on function public.self_register_organization(uuid, text, text, text, text, text) is
  'Alta propia de un local (ADR 0053): email confirmado y probado, una prueba por persona, Pro por 14 días. Solo service_role.';
