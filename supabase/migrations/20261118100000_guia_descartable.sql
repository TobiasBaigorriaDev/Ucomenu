-- Guía de primeros pasos descartable por cuenta (nivel M; ficha agile/cambios/guia-descartable.md).
--
-- Cada persona (Dueño o Staff) puede ocultar la guía de primeros pasos del Resumen de un local y volver a mostrarla. Es una
-- PREFERENCIA, no un permiso: no cambia lo que la persona puede leer o hacer. Mismo molde que la vista por sucursal (ADR 0034):
--
--  * member_guide_dismissals: una fila por persona y local (vale para todos sus dispositivos). Sin permisos ni políticas: nadie la
--    toca por la API; solo las dos funciones de abajo. La clave foránea a memberships la borra al quitar a la persona del local.
--  * set_my_guide_dismissed(org, ocultar) -> 'ok' | 'unavailable': solo para quien es miembro de ese local. Ocultar crea la fila;
--    mostrar la borra.
--  * my_guide_dismissed(org) -> boolean: si quien llama ocultó la guía de ese local. Falso para quien no es miembro.
--
-- Rollback (la guía vuelve a verse siempre). ORDEN: desplegar primero el código anterior, que no llama a estas funciones:
--   drop function public.set_my_guide_dismissed(uuid, boolean);
--   drop function public.my_guide_dismissed(uuid);
--   drop table public.member_guide_dismissals;

begin;

create table public.member_guide_dismissals (
  user_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, organization_id),
  -- Quitar la membresía (o la cuenta) borra la preferencia.
  foreign key (user_id, organization_id)
    references public.memberships (user_id, organization_id) on delete cascade
);
comment on table public.member_guide_dismissals is
  'Quién ocultó la guía de primeros pasos del Resumen de su local (preferencia, no permiso). Sin acceso por la API: solo funciones.';

alter table public.member_guide_dismissals enable row level security;
revoke all on table public.member_guide_dismissals from public, anon, authenticated, service_role;

create function public.set_my_guide_dismissed(p_org uuid, p_dismissed boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or p_org is null or p_dismissed is null or not private.is_org_member(p_org) then
    return 'unavailable';
  end if;

  if p_dismissed then
    insert into public.member_guide_dismissals (user_id, organization_id)
    values (v_user, p_org)
    on conflict (user_id, organization_id) do nothing;
  else
    delete from public.member_guide_dismissals where user_id = v_user and organization_id = p_org;
  end if;
  return 'ok';
end;
$$;
comment on function public.set_my_guide_dismissed(uuid, boolean) is
  'Oculta (true) o vuelve a mostrar (false) la guía de primeros pasos de p_org para quien llama. Solo miembros.';

create function public.my_guide_dismissed(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_guide_dismissals d
    where d.user_id = (select auth.uid())
      and d.organization_id = p_org
      and private.is_org_member(p_org)
  );
$$;
comment on function public.my_guide_dismissed(uuid) is
  'Si quien llama ocultó la guía de primeros pasos de p_org. Falso para quien no es miembro.';

revoke all on function public.set_my_guide_dismissed(uuid, boolean) from public, anon;
revoke all on function public.my_guide_dismissed(uuid) from public, anon;
grant execute on function public.set_my_guide_dismissed(uuid, boolean) to authenticated;
grant execute on function public.my_guide_dismissed(uuid) to authenticated;

commit;
