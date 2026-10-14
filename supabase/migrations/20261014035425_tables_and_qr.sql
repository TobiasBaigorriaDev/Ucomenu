-- Mesas y QR (ficha agile/cambios/mesas-y-qr.md, ADR 0009).
--
-- Solo aditiva: una tabla nueva, una restricción única sobre branches, dos triggers y una función pública;
-- no toca datos. Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop function public.resolve_table_qr(text); drop table public.tables;
--   alter table public.branches drop constraint branches_id_organization_id_key;
--   drop function private.enforce_table_limit(); drop function private.rotate_table_token();
--
-- Reglas de fondo:
--  * El qr_token lo genera SIEMPRE la base (32 hex = UUID v4 sin guiones, 122 bits); la API no puede fijarlo.
--    Regenerar el QR es «tocar» la columna: un trigger descarta el valor recibido y pone uno nuevo.
--  * anon NO lee tables (si pudiera, listaría todos los tokens). La entrada pública /t/{token} usa
--    public.resolve_table_qr, que devuelve lo mínimo o null.
--  * Escribir exige miembro de la organización y cuenta que puede escribir (org_can_write), igual que la carta.
--  * Tope tables_per_branch (ADR 0006): cuenta mesas ACTIVAS de la sucursal; antes de contar comprueba la
--    membresía y que la sucursal sea de la organización, para no filtrar el uso de otra organización.

-- Permite la clave foránea compuesta (branch_id, organization_id): una mesa nunca apunta a una sucursal ajena.
alter table public.branches
  add constraint branches_id_organization_id_key unique (id, organization_id);

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  label text not null
    check (length(btrim(label)) between 1 and 40),
  qr_token text not null default replace(gen_random_uuid()::text, '-', '')
    check (qr_token ~ '^[0-9a-f]{32}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches (id, organization_id) on delete cascade
);
comment on table public.tables is
  'Mesa de una sucursal. qr_token opaco generado por la base (nunca el número de mesa); sin borrado desde la API.';
comment on column public.tables.qr_token is
  'Identificador opaco del QR. Lo fija la base; escribir esta columna por la API la regenera (ver rotate_table_token).';

create unique index tables_qr_token_key on public.tables (qr_token);
-- Etiqueta única por sucursal sin distinguir mayúsculas; también sirve para listar por sucursal.
create unique index tables_branch_label_key on public.tables (branch_id, lower(btrim(label)));
-- La clave foránea compuesta necesita buscar por organización en los borrados en cascada.
create index tables_organization_id_idx on public.tables (organization_id);

alter table public.tables enable row level security;

-- ---------------------------------------------------------------------------
-- Regeneración del token
-- ---------------------------------------------------------------------------
-- Cualquier UPDATE que cambie qr_token recibe uno NUEVO generado acá: el valor enviado se descarta, así nadie
-- puede elegir un token adivinable. Mandar el valor actual no cambia nada. Solo el rol que escribe por la API
-- tiene permiso de UPDATE sobre la columna (ver grants); service_role tampoco puede fijarlo en un UPDATE.

create function private.rotate_table_token()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.qr_token is distinct from old.qr_token then
    new.qr_token := replace(gen_random_uuid()::text, '-', '');
  end if;
  return new;
end;
$$;

create trigger tables_rotate_token
  before update of qr_token on public.tables
  for each row execute function private.rotate_table_token();

-- ---------------------------------------------------------------------------
-- Tope de mesas activas por sucursal (se aplica al crear y al ACTIVAR; activo -> inactivo nunca se bloquea)
-- ---------------------------------------------------------------------------

create function private.enforce_table_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if not new.is_active then
    return new;
  end if;
  -- Ya estaba activa en la misma sucursal: editarla no consume cupo.
  if tg_op = 'UPDATE' and old.is_active and old.branch_id = new.branch_id then
    return new;
  end if;
  -- Usuario de la API sin membresía en esta organización: no se cuenta ni se informa; decide RLS.
  if (select auth.uid()) is not null and not private.is_org_member(new.organization_id) then
    return new;
  end if;
  -- La sucursal tiene que ser de esa organización; si no, la clave foránea rechaza la fila y acá no se cuenta
  -- (contar una sucursal ajena revelaría su uso).
  if not exists (
    select 1 from public.branches b
    where b.id = new.branch_id and b.organization_id = new.organization_id
  ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('limit:tables:' || new.branch_id::text, 0));

  v_limit := private.org_limit(new.organization_id, 'tables_per_branch');
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.tables
  where branch_id = new.branch_id and is_active;

  if v_count >= v_limit then
    raise exception 'limit_exceeded:tables_per_branch'
      using errcode = '53400',
            detail = format('limit=%s active=%s', v_limit, v_count),
            hint = 'Desactivá una mesa o cambiá de plan.';
  end if;
  return new;
end;
$$;

create trigger tables_enforce_limit
  before insert or update on public.tables
  for each row execute function private.enforce_table_limit();

-- ---------------------------------------------------------------------------
-- Políticas (sin acceso para anon; sin DELETE)
-- ---------------------------------------------------------------------------

create policy "tables: lectura de miembros"
  on public.tables for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy "tables: los miembros crean con la cuenta al día"
  on public.tables for insert
  to authenticated
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

create policy "tables: los miembros actualizan con la cuenta al día"
  on public.tables for update
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id))
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

-- ---------------------------------------------------------------------------
-- Permisos explícitos sobre la Data API (por columna)
-- ---------------------------------------------------------------------------
-- id, created_at y qr_token (al crear) los pone la base. branch_id y organization_id se fijan al crear y no se
-- pueden cambiar. Sin DELETE: desactivar es la baja.

revoke all on table public.tables from anon, authenticated;
grant select on table public.tables to authenticated;
grant insert (organization_id, branch_id, label, is_active) on table public.tables to authenticated;
grant update (label, is_active, qr_token) on table public.tables to authenticated;

revoke all on function private.rotate_table_token(), private.enforce_table_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Resolución pública del QR
-- ---------------------------------------------------------------------------
-- Devuelve lo mínimo para armar la carta de la mesa, o null si el token no existe, tiene formato inválido o la
-- organización está inactiva. Revela solo organización, sucursal, etiqueta, si la mesa está activa y si la
-- carta está disponible; nunca ids, el token ni la causa de una suspensión.

create function public.resolve_table_qr(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_slug', o.slug,
    'org_name', o.name,
    'branch_slug', b.slug,
    'table_label', t.label,
    'table_active', t.is_active,
    'status', case when private.org_is_published(o.id) then 'available' else 'suspended' end
  )
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where p_token ~ '^[0-9a-f]{32}$'
    and t.qr_token = p_token
    and o.is_active;
$$;
comment on function public.resolve_table_qr(text) is
  'Entrada pública /t/{token}: organización, sucursal, etiqueta y estado de la mesa, o null. anon no lee public.tables.';

revoke all on function public.resolve_table_qr(text) from public, anon, authenticated;
grant execute on function public.resolve_table_qr(text) to anon, authenticated;
