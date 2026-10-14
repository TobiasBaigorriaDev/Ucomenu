-- Historial de cambios de precio (nivel C: dinero + datos). Ficha: agile/cambios/historial-de-precios.md.
--
-- Aditiva: una tabla nueva, tres triggers y una política de lectura. No toca datos existentes, ni el esquema ni los
-- permisos de products. Rollback (local): git revert + `pnpm db:reset`. En una base con datos (el historial se pierde):
--   drop trigger products_record_price_change on public.products;
--   drop table public.price_history;
--   drop function private.record_price_change(), private.price_history_append_only();
--
-- Reglas de fondo:
--  * Se registra SOLO un UPDATE de products.price_cents que cambia el valor. No se registra el alta del
--    plato, ni la edición de otros campos, ni un UPDATE que deja el mismo precio.
--  * El registro lo escribe un trigger AFTER UPDATE en la MISMA transacción que el cambio: si el UPDATE falla
--    (RLS, tope, constraint) o la transacción se revierte, no queda historial.
--  * «Quién» sale de la sesión de base (auth.uid(), derivado del JWT que valida la API), nunca de un campo
--    del pedido. Sin usuario autenticado (service_role, psql, migraciones, seed) changed_by queda NULL:
--    NULL significa «operación técnica, sin usuario».
--  * Solo se agrega: la API no inserta, no modifica ni borra; tampoco service_role (privilegios revocados)
--    ni el dueño de la tabla sin desactivar a propósito el trigger de solo-agregado.
--  * Borrados explícitos, sin cascada (nada del historial se borra por un borrado de otra tabla):
--      - organización: clave foránea ON DELETE RESTRICT. Una organización con historial NO se puede borrar hasta que
--        exista una decisión aceptada de retención/purga (qué se conserva y cuánto tiempo).
--      - plato: SIN clave foránea. Borrar un plato (permitido hoy a Dueño y Staff por RLS) no se bloquea y el historial
--        sobrevive con su product_id: el registro de «quién cambió qué precio» no depende de que el plato exista.
--      - persona: SIN clave foránea (changed_by). Dar de baja a alguien (borra su usuario de Auth) no se bloquea ni
--        reescribe el historial.
--    El trigger escribe organization_id y product_id de la misma fila de products, así que son coherentes de origen.

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Sin clave foránea a propósito: sobrevive al borrado del plato (ver arriba).
  product_id uuid not null,
  -- Usuario de Auth que hizo el cambio. NULL = operación técnica sin usuario autenticado.
  -- Sin clave foránea a propósito: sobrevive a la baja de la persona (ver arriba).
  changed_by uuid,
  changed_at timestamptz not null default clock_timestamp(),
  old_price_cents integer not null check (old_price_cents >= 0),
  new_price_cents integer not null check (new_price_cents >= 0),
  check (old_price_cents <> new_price_cents)
);
comment on table public.price_history is
  'Cambios efectivos de products.price_cents, escritos solo por trigger. Solo se agrega; sin escritura por la API ni service_role.';
comment on column public.price_history.changed_by is
  'auth.uid() de la sesión que cambió el precio; NULL = operación técnica sin usuario. Sin clave foránea: sobrevive a la baja de la persona.';
comment on column public.price_history.changed_at is
  'Instante real del cambio (clock_timestamp), para ordenar varios cambios dentro de una misma transacción.';

-- Listados por plato y por organización, del más nuevo al más viejo; el segundo también sirve a la clave foránea.
create index price_history_product_idx on public.price_history (product_id, changed_at desc);
create index price_history_organization_idx on public.price_history (organization_id, changed_at desc);

alter table public.price_history enable row level security;

-- ---------------------------------------------------------------------------
-- Registro del cambio
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: la API no tiene INSERT sobre la tabla. Corre con el pedido del usuario, por eso
-- (select auth.uid()) es la identidad de la sesión. El WHEN deja pasar solo los cambios efectivos.

create function private.record_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.price_history (organization_id, product_id, changed_by, old_price_cents, new_price_cents)
  values (new.organization_id, new.id, (select auth.uid()), old.price_cents, new.price_cents);
  return null;
end;
$$;

-- AFTER: corre cuando la fila ya pasó la política de RLS y los demás triggers BEFORE (tope, etc.).
create trigger products_record_price_change
  after update of price_cents on public.products
  for each row
  when (old.price_cents is distinct from new.price_cents)
  execute function private.record_price_change();

-- ---------------------------------------------------------------------------
-- Solo se agrega
-- ---------------------------------------------------------------------------
-- Barrera para quien igual tenga privilegios (dueño de la tabla, superusuario): UPDATE, DELETE y TRUNCATE
-- fallan. Una purga deliberada exige `alter table public.price_history disable trigger ...` y una decisión
-- de retención aceptada; no existe hoy.

create function private.price_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'price_history es de solo agregado (% rechazado)', tg_op
    using errcode = '42501';
end;
$$;

create trigger price_history_no_update_delete
  before update or delete on public.price_history
  for each row execute function private.price_history_append_only();

create trigger price_history_no_truncate
  before truncate on public.price_history
  for each statement execute function private.price_history_append_only();

-- ---------------------------------------------------------------------------
-- Lectura y permisos
-- ---------------------------------------------------------------------------
-- Lectura: Dueño y Staff de la organización (decisión del usuario, 2026-10-14); anon, nada. Se lee aun con la
-- cuenta en solo lectura o suspendida (es consulta, no escritura de catálogo). Sin políticas de INSERT, UPDATE
-- ni DELETE y sin esos privilegios: la API no puede escribir.

create policy "price_history: lectura de miembros"
  on public.price_history for select
  to authenticated
  using (private.is_org_member(organization_id));

revoke all on table public.price_history from anon, authenticated;
grant select on table public.price_history to authenticated;

-- Supabase otorga todo a service_role por defecto: se le quita todo lo que escribe. Conserva SELECT.
revoke insert, update, delete, truncate, references, trigger on table public.price_history from service_role;

revoke all on function private.record_price_change(), private.price_history_append_only()
  from public, anon, authenticated;
