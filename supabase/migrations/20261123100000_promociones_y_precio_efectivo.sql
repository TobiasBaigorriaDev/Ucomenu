-- Promociones programadas y función de precio efectivo (nivel C: precio exhibido al público y plan). Ficha:
-- agile/cambios/promociones-y-precio-efectivo.md · ADR 0040 (decisiones 2 a 7) · docs/producto.md, módulo 8.
--
-- Qué hace:
--  * Catálogo: `promotions` entra a `plans.features` y a `plans_features_check`, y se concede a Pro y Premium (ADR 0040, decisión 6).
--  * Tablas `promotions` (tipo de descuento, valor, días, franja en minutos del día, fechas, pausa), `promotion_targets` (platos o
--    categorías) y `promotion_branches` (sucursales cuando no son todas). Todas con clave foránea compuesta a la organización:
--    una promoción no puede apuntar a platos ni sucursales de otra.
--  * Escritura SOLO del Dueño, con la cuenta al día y la función en el plan (`private.can_manage_promotions`); el Staff las lee.
--    `anon` no toca las tablas: la carta lee lo vigente por `effective_prices` (abajo), así que una promoción futura no se ve.
--  * `promotion_history`: cada alta, cambio y baja de una promoción, y cada plato, categoría o sucursal que se suma o se quita, queda
--    en un historial de SOLO-AGREGADO por trigger (ni la API ni `service_role` escriben; UPDATE, DELETE y TRUNCATE fallan). Sin
--    clave foránea a la promoción (sobrevive a su baja) ni a la persona; con clave RESTRICT a la organización: se purga con el
--    borrado de la organización (`private.purge_organization_promotion_history`, que llama `admin_delete_organization`).
--  * `public.effective_prices(sucursal, plato, instante)`: LA autoridad del precio. Precio de la sucursal (o el base) → promoción
--    vigente en la hora de la sucursal (`branches.timezone`) → piso de $ 0, al centavo. Sin acumular: gana el precio más bajo; una
--    promoción que no baja el precio no se aplica. La carta la lee en vivo; los pedidos del mozo (ADR 0041) usarán la misma.
--
-- Semántica del horario (la replica `src/lib/promociones/precio.ts`; una prueba compara ambas con la misma tabla de casos):
--  * Días: máscara de bits, lunes = bit 0 … domingo = bit 6. Franja: `start_minute` (0–1439, inclusive) a `end_minute` (1–1440,
--    exclusivo) en minutos del reloj de pared de la sucursal. `end_minute < start_minute` cruza la medianoche y pertenece AL DÍA EN
--    QUE EMPIEZA (viernes 22:00–02:00 incluye el sábado a las 01:00 si el viernes está marcado). `start_minute = end_minute` no existe;
--    «todo el día» es 0–1440.
--  * `starts_on` / `ends_on` (inclusivos, opcionales) se miden sobre el día en que EMPIEZA la franja: una franja que empieza el último
--    día permitido sigue vigente después de la medianoche.
--  * Los segundos no cuentan: se evalúa el minuto del reloj de pared. Con horario de verano rige la hora de pared de la sucursal.
--  * Redondeo del porcentaje: precio × (100 − p) / 100, mitad hacia arriba, en enteros. Monto: base − monto, piso 0. Precio fijo: el valor.
--  * Empate de precio entre dos promociones: gana la más antigua (`created_at`, luego `id`).
--  * Las promociones SIGUEN aplicándose con la cuenta en solo lectura (la carta no cambia de precio por la mora); dejan de aplicarse
--    con la cuenta suspendida o la sucursal desactivada, o si el plan (y ninguna vista previa vigente) incluye la función.
--
-- `p_at` (instante a consultar, para la vista previa por día y hora del Dueño) solo lo respeta quien es miembro de la organización;
-- para cualquier otro el instante es siempre el actual (una promoción futura no se filtra a la carta).
--
-- Rollback (local: git revert + `pnpm db:reset`). En una base con datos, en UNA transacción y DESPUÉS de desplegar el código anterior,
-- en este orden (las políticas de las tablas dependen de `can_manage_promotions`, así que primero se sueltan las tablas):
--   1. `drop table public.promotion_branches, public.promotion_targets, public.promotions;` (arrastra sus políticas y triggers)
--   2. `drop function public.effective_prices(uuid, uuid, timestamptz), private.can_manage_promotions(uuid);`
--   3. quitar `promotions` de `plans.features` y de `plans_features_check`.
--   4. `promotion_history` es un registro de auditoría de solo-agregado: si tiene filas, CONSERVARLA y conservar también
--      `private.purge_organization_promotion_history` y ESTA versión de `admin_delete_organization` (la anterior no purga el historial y
--      el borrado de esas organizaciones fallaría por la clave RESTRICT). Sin filas: `drop table public.promotion_history;`,
--      `drop function private.record_promotion_change(), private.promotion_history_append_only(),
--      private.purge_organization_promotion_history(uuid);` y volver a crear `public.admin_delete_organization` con el cuerpo de
--      20261102100000_borrado_de_organizaciones.sql.

begin;

-- ---------------------------------------------------------------------------
-- Catálogo de planes
-- ---------------------------------------------------------------------------

alter table public.plans drop constraint plans_features_check;
alter table public.plans add constraint plans_features_check
  check (features <@ array['menu', 'waiter_call', 'loyalty', 'analytics', 'video_feed', 'promotions']);

update public.plans
set features = array_append(features, 'promotions')
where code in ('pro', 'premium') and not ('promotions' = any (features));

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  discount_type text not null,
  discount_value integer not null,
  -- Lunes = bit 0 … domingo = bit 6. Al menos un día.
  weekdays_mask smallint not null,
  start_minute smallint not null,
  end_minute smallint not null,
  starts_on date,
  ends_on date,
  -- true = todas las sucursales de la organización. false = solo las de `promotion_branches` (ninguna fila = ninguna sucursal).
  all_branches boolean not null default true,
  -- false = pausada: no se aplica pero se conserva.
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  constraint promotions_id_organization_key unique (id, organization_id),
  constraint promotions_name_check check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint promotions_type_check check (discount_type in ('percent', 'amount', 'fixed_price')),
  constraint promotions_value_check check (
    case discount_type
      when 'percent' then discount_value between 1 and 100
      when 'amount' then discount_value >= 1
      else discount_value >= 0
    end
  ),
  constraint promotions_weekdays_check check (weekdays_mask between 1 and 127),
  constraint promotions_start_check check (start_minute between 0 and 1439),
  constraint promotions_end_check check (end_minute between 1 and 1440),
  constraint promotions_window_check check (start_minute <> end_minute),
  constraint promotions_dates_check check (starts_on is null or ends_on is null or starts_on <= ends_on)
);
comment on table public.promotions is
  'Promociones programadas de una organización (ADR 0040). Descuento sobre el precio base de platos o categorías, por días, franja horaria (puede cruzar la medianoche) y fechas, en la hora de cada sucursal. Las escribe solo el Dueño; el precio efectivo lo calcula effective_prices.';
comment on column public.promotions.discount_value is
  'percent: 1 a 100 · amount: centavos a descontar (≥ 1) · fixed_price: precio final en centavos (≥ 0).';
comment on column public.promotions.weekdays_mask is
  'Días en que EMPIEZA la franja: lunes = bit 0 … domingo = bit 6.';
comment on column public.promotions.start_minute is 'Minuto del día en que empieza (0–1439, inclusive), en el reloj de pared de la sucursal.';
comment on column public.promotions.end_minute is
  'Minuto del día en que termina (1–1440, exclusivo). Menor que start_minute = cruza la medianoche y pertenece al día en que empieza.';
comment on column public.promotions.all_branches is
  'true = todas las sucursales. false = solo las de promotion_branches (sin filas, ninguna).';

create index promotions_organization_idx on public.promotions (organization_id);

create table public.promotion_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  promotion_id uuid not null,
  product_id uuid,
  category_id uuid,
  foreign key (promotion_id, organization_id) references public.promotions (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id) references public.products (id, organization_id) on delete cascade,
  foreign key (category_id, organization_id) references public.categories (id, organization_id) on delete cascade,
  constraint promotion_targets_one_check check ((product_id is null) <> (category_id is null))
);
comment on table public.promotion_targets is
  'Platos o categorías a los que aplica una promoción (exactamente uno de los dos por fila). Una promoción sin filas no aplica a nada. Se borra con el plato, la categoría o la promoción.';
create unique index promotion_targets_product_key on public.promotion_targets (promotion_id, product_id) where product_id is not null;
create unique index promotion_targets_category_key on public.promotion_targets (promotion_id, category_id) where category_id is not null;
create index promotion_targets_product_idx on public.promotion_targets (product_id) where product_id is not null;
create index promotion_targets_category_idx on public.promotion_targets (category_id) where category_id is not null;
create index promotion_targets_organization_idx on public.promotion_targets (organization_id);

create table public.promotion_branches (
  organization_id uuid not null,
  promotion_id uuid not null,
  branch_id uuid not null,
  primary key (promotion_id, branch_id),
  foreign key (promotion_id, organization_id) references public.promotions (id, organization_id) on delete cascade,
  foreign key (branch_id, organization_id) references public.branches (id, organization_id) on delete cascade
);
comment on table public.promotion_branches is
  'Sucursales de una promoción cuando promotions.all_branches es false.';
create index promotion_branches_branch_idx on public.promotion_branches (branch_id);
create index promotion_branches_organization_idx on public.promotion_branches (organization_id);

create table public.promotion_history (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: una organización con historial no se borra sin pasar por su purga (admin_delete_organization).
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Sin clave foránea a propósito: el historial sobrevive a la baja de la promoción.
  promotion_id uuid not null,
  event text not null
    check (event in ('created', 'updated', 'deleted', 'target_added', 'target_removed', 'branch_added', 'branch_removed')),
  -- auth.uid() de la sesión; NULL = operación técnica sin usuario. Sin clave foránea: sobrevive a la baja de la persona.
  changed_by uuid,
  changed_at timestamptz not null default clock_timestamp(),
  -- created/updated: la fila de la promoción después del cambio · deleted: la fila con sus platos, categorías y sucursales ·
  -- target_*/branch_*: la fila del plato, categoría o sucursal.
  snapshot jsonb not null
);
comment on table public.promotion_history is
  'Historial de solo-agregado de las promociones (ADR 0040), escrito solo por trigger. Sin escritura por la API ni service_role; UPDATE, DELETE y TRUNCATE fallan. Se purga con el borrado de la organización.';
create index promotion_history_promotion_idx on public.promotion_history (promotion_id, changed_at desc);
create index promotion_history_organization_idx on public.promotion_history (organization_id, changed_at desc);

alter table public.promotions enable row level security;
alter table public.promotion_targets enable row level security;
alter table public.promotion_branches enable row level security;
alter table public.promotion_history enable row level security;

-- ---------------------------------------------------------------------------
-- Historial: lo escribe un trigger; solo se agrega
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: la API no tiene INSERT sobre la tabla. Corre con el pedido de la persona, así que (select auth.uid()) es la
-- identidad de la sesión. Cuando la baja viene de la CASCADA de otra baja (la organización o la promoción ya no existen) no
-- registra nada: la baja de la promoción se registra una vez, con sus platos y sucursales, y el borrado de la organización purga
-- su historial antes de borrarla.

create function private.record_promotion_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_org uuid;
  v_promotion uuid;
  v_event text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  v_org := (v_row ->> 'organization_id')::uuid;

  -- Un BEFORE DELETE tiene que devolver OLD para que el borrado siga (NULL lo cancelaría); los AFTER ignoran el valor.
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = v_org) then
    if tg_when = 'BEFORE' then
      return old;
    end if;
    return null;
  end if;

  if tg_table_name = 'promotions' then
    v_promotion := (v_row ->> 'id')::uuid;
    v_event := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
    if tg_op = 'DELETE' then
      -- BEFORE DELETE: los platos, categorías y sucursales todavía existen y quedan en la constancia de la baja.
      v_row := v_row || jsonb_build_object(
        'targets',
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.promotion_targets t where t.promotion_id = v_promotion), '[]'::jsonb),
        'branches',
        coalesce((select jsonb_agg(to_jsonb(b) order by b.branch_id) from public.promotion_branches b where b.promotion_id = v_promotion), '[]'::jsonb)
      );
    end if;
  else
    v_promotion := (v_row ->> 'promotion_id')::uuid;
    if tg_op = 'DELETE' and not exists (select 1 from public.promotions p where p.id = v_promotion) then
      return null;
    end if;
    v_event := case
      when tg_table_name = 'promotion_targets' and tg_op = 'INSERT' then 'target_added'
      when tg_table_name = 'promotion_targets' then 'target_removed'
      when tg_op = 'INSERT' then 'branch_added'
      else 'branch_removed'
    end;
  end if;

  insert into public.promotion_history (organization_id, promotion_id, event, changed_by, snapshot)
  values (v_org, v_promotion, v_event, (select auth.uid()), v_row);

  if tg_op = 'DELETE' and tg_when = 'BEFORE' then
    return old;
  end if;
  return null;
end;
$$;

create trigger promotions_record_insert
  after insert on public.promotions
  for each row execute function private.record_promotion_change();
create trigger promotions_record_update
  after update on public.promotions
  for each row when (old.* is distinct from new.*) execute function private.record_promotion_change();
create trigger promotions_record_delete
  before delete on public.promotions
  for each row execute function private.record_promotion_change();

create trigger promotion_targets_record_insert
  after insert on public.promotion_targets
  for each row execute function private.record_promotion_change();
create trigger promotion_targets_record_delete
  after delete on public.promotion_targets
  for each row execute function private.record_promotion_change();

create trigger promotion_branches_record_insert
  after insert on public.promotion_branches
  for each row execute function private.record_promotion_change();
create trigger promotion_branches_record_delete
  after delete on public.promotion_branches
  for each row execute function private.record_promotion_change();

create function private.promotion_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'promotion_history es de solo agregado (% rechazado)', tg_op
    using errcode = '42501';
end;
$$;

create trigger promotion_history_no_update_delete
  before update or delete on public.promotion_history
  for each row execute function private.promotion_history_append_only();
create trigger promotion_history_no_truncate
  before truncate on public.promotion_history
  for each statement execute function private.promotion_history_append_only();

-- Purga del historial de una organización que se borra. SIN EXECUTE para ningún rol: la llama `admin_delete_organization` DESPUÉS de
-- `purge_organization_price_history`, que exige la baja auditada de 30 días o más. Aun así rechaza una organización que sigue activa.
create function private.purge_organization_promotion_history(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_deleted integer;
begin
  select o.is_active into v_active from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if v_active then
    raise exception 'organization_still_active' using errcode = '55000';
  end if;

  alter table public.promotion_history disable trigger promotion_history_no_update_delete;
  delete from public.promotion_history where organization_id = p_org;
  get diagnostics v_deleted = row_count;
  alter table public.promotion_history enable trigger promotion_history_no_update_delete;

  return v_deleted;
end;
$$;
comment on function private.purge_organization_promotion_history(uuid) is
  'Purga el historial de promociones de una organización dada de baja. Apaga el trigger de solo-agregado dentro de la transacción. Sin EXECUTE para ningún rol de la API: solo la llama admin_delete_organization (ADR 0040).';

revoke all on function private.record_promotion_change(), private.promotion_history_append_only(), private.purge_organization_promotion_history(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Permisos y políticas
-- ---------------------------------------------------------------------------
-- Gestiona el Dueño, con la cuenta al día (`has_feature` ya excluye solo lectura y suspendida) y la función en el plan.

create function private.can_manage_promotions(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_owner(org_id) and private.has_feature(org_id, 'promotions');
$$;
revoke all on function private.can_manage_promotions(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_promotions(uuid) to authenticated;

revoke all on table public.promotions, public.promotion_targets, public.promotion_branches, public.promotion_history
  from anon, authenticated;

create policy "promotions: lectura de miembros"
  on public.promotions for select to authenticated
  using (private.is_org_member(organization_id));
create policy "promotions: el Dueño crea"
  on public.promotions for insert to authenticated
  with check (private.can_manage_promotions(organization_id));
create policy "promotions: el Dueño actualiza"
  on public.promotions for update to authenticated
  using (private.can_manage_promotions(organization_id))
  with check (private.can_manage_promotions(organization_id));
create policy "promotions: el Dueño borra"
  on public.promotions for delete to authenticated
  using (private.can_manage_promotions(organization_id));

create policy "promotion_targets: lectura de miembros"
  on public.promotion_targets for select to authenticated
  using (private.is_org_member(organization_id));
create policy "promotion_targets: el Dueño agrega"
  on public.promotion_targets for insert to authenticated
  with check (private.can_manage_promotions(organization_id));
create policy "promotion_targets: el Dueño quita"
  on public.promotion_targets for delete to authenticated
  using (private.can_manage_promotions(organization_id));

create policy "promotion_branches: lectura de miembros"
  on public.promotion_branches for select to authenticated
  using (private.is_org_member(organization_id));
create policy "promotion_branches: el Dueño agrega"
  on public.promotion_branches for insert to authenticated
  with check (private.can_manage_promotions(organization_id));
create policy "promotion_branches: el Dueño quita"
  on public.promotion_branches for delete to authenticated
  using (private.can_manage_promotions(organization_id));

create policy "promotion_history: lectura de miembros"
  on public.promotion_history for select to authenticated
  using (private.is_org_member(organization_id));

grant select on table public.promotions, public.promotion_targets, public.promotion_branches, public.promotion_history to authenticated;
grant insert (organization_id, name, discount_type, discount_value, weekdays_mask, start_minute, end_minute, starts_on, ends_on, all_branches, is_active)
  on table public.promotions to authenticated;
grant update (name, discount_type, discount_value, weekdays_mask, start_minute, end_minute, starts_on, ends_on, all_branches, is_active)
  on table public.promotions to authenticated;
grant delete on table public.promotions to authenticated;
grant insert (organization_id, promotion_id, product_id, category_id) on table public.promotion_targets to authenticated;
grant delete on table public.promotion_targets to authenticated;
grant insert (organization_id, promotion_id, branch_id) on table public.promotion_branches to authenticated;
grant delete on table public.promotion_branches to authenticated;

-- El historial no lo escribe nadie de la API ni el servicio técnico; este conserva SELECT.
revoke insert, update, delete, truncate, references, trigger on table public.promotion_history from service_role;

-- ---------------------------------------------------------------------------
-- Precio efectivo
-- ---------------------------------------------------------------------------
-- Una fila por plato con precio efectivo. Con `p_product` nulo: solo los platos de la organización con una promoción vigente (la
-- carta pone el resto con su precio de siempre). Con `p_product`: una fila para ese plato, con promoción o sin ella (los pedidos);
-- ninguna fila si el plato no es de la organización de la sucursal o si el plato o su categoría están desactivados. Ninguna fila tampoco si la sucursal está desactivada o la
-- organización no está publicada.

create function public.effective_prices(p_branch uuid, p_product uuid default null, p_at timestamptz default null)
returns table (
  product_id uuid,
  base_price_cents integer,
  price_cents integer,
  promotion_id uuid,
  promotion_name text,
  discount_type text,
  discount_value integer,
  ends_local timestamp
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
  v_at timestamptz;
  v_local timestamp;
  v_date date;
  v_minute integer;
  v_has boolean;
begin
  select b.organization_id, b.timezone into v_org, v_tz
  from public.branches b
  where b.id = p_branch and b.is_active;
  if not found or not private.org_is_published(v_org) then
    return;
  end if;

  v_at := case when p_at is not null and private.is_org_member(v_org) then p_at else clock_timestamp() end;
  v_local := v_at at time zone v_tz;
  v_date := v_local::date;
  v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_has := private.plan_grants(v_org, 'promotions');

  return query
  with prices as (
    select p.id as pid, p.category_id as cid, coalesce(pa.price_cents, p.price_cents) as base
    from public.products p
    join public.categories c on c.id = p.category_id and c.organization_id = p.organization_id
    left join public.product_availability pa on pa.product_id = p.id and pa.branch_id = p_branch
    -- Solo lo que la carta pública publica (la RLS de platos y categorías exige activos): un plato o una categoría desactivados
    -- no se exponen por esta función aunque tengan una promoción.
    where p.organization_id = v_org and p.is_active and c.is_active and (p_product is null or p.id = p_product)
  ),
  candidates as (
    select pr.pid, pm.id as promo_id, pm.name as promo_name, pm.discount_type as promo_type, pm.discount_value as promo_value,
           pm.created_at as promo_created, occ.ends_local as promo_ends,
           case pm.discount_type
             when 'percent' then (pr.base::bigint * (100 - pm.discount_value) + 50) / 100
             when 'amount' then greatest(0::bigint, pr.base::bigint - pm.discount_value)
             else pm.discount_value::bigint
           end as promo_price,
           pr.base
    from prices pr
    join public.promotion_targets t on t.organization_id = v_org and (t.product_id = pr.pid or t.category_id = pr.cid)
    join public.promotions pm on pm.id = t.promotion_id and pm.organization_id = v_org
    cross join lateral (
      select o.d::timestamp
               + case when pm.end_minute < pm.start_minute then interval '1 day' else interval '0' end
               + pm.end_minute * interval '1 minute' as ends_local
      from (values (v_date, 0), (v_date - 1, 1)) as o(d, back)
      where ((pm.weekdays_mask::integer >> (extract(isodow from o.d)::integer - 1)) & 1) = 1
        and (pm.starts_on is null or o.d >= pm.starts_on)
        and (pm.ends_on is null or o.d <= pm.ends_on)
        and (
          (o.back = 0 and v_minute >= pm.start_minute and (pm.end_minute < pm.start_minute or v_minute < pm.end_minute))
          or (o.back = 1 and pm.end_minute < pm.start_minute and v_minute < pm.end_minute)
        )
      limit 1
    ) occ
    where v_has
      and pm.is_active
      and (pm.all_branches or exists (
        select 1 from public.promotion_branches pb where pb.promotion_id = pm.id and pb.branch_id = p_branch
      ))
  ),
  winners as (
    select distinct on (c.pid) c.*
    from candidates c
    where c.promo_price < c.base
    order by c.pid, c.promo_price, c.promo_created, c.promo_id
  )
  select pr.pid, pr.base, coalesce(w.promo_price, pr.base::bigint)::integer,
         w.promo_id, w.promo_name, w.promo_type, w.promo_value, w.promo_ends
  from prices pr
  left join winners w on w.pid = pr.pid
  where p_product is not null or w.pid is not null;
end;
$$;
comment on function public.effective_prices(uuid, uuid, timestamptz) is
  'Precio efectivo de la carta y de los pedidos (ADR 0040): precio de la sucursal o base → promoción vigente en la hora de la sucursal → piso de 0. Una fila por plato con promoción (p_product nulo) o la del plato pedido. p_at solo lo respeta un miembro de la organización.';

revoke all on function public.effective_prices(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.effective_prices(uuid, uuid, timestamptz) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Borrado de organizaciones: también purga el historial de promociones
-- ---------------------------------------------------------------------------
-- `create or replace` conserva el EXECUTE exclusivo de `service_role`. Cambian tres líneas respecto de 20261102100000: la purga nueva,
-- su cifra en la auditoría y su cifra en el resumen que devuelve.

create or replace function public.admin_delete_organization(
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
  v_promo_purged integer;
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
  -- El historial de promociones (ADR 0040) se purga en la misma transacción, después de la comprobación de arriba.
  v_promo_purged := private.purge_organization_promotion_history(p_org);

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
      'promotion_history_purged', v_promo_purged,
      'branches', v_branches,
      'products', v_products,
      'memberships', v_memberships,
      'payments_kept', v_payments,
      'voids_kept', v_voids
    )
  );

  return jsonb_build_object('price_history_purged', v_purged, 'promotion_history_purged', v_promo_purged, 'payments_kept', v_payments);
end;
$$;
comment on function public.admin_delete_organization(uuid, uuid, text, text) is
  'Borra definitivamente una organización dada de baja hace 30 días o más: purga su historial de precios y el de promociones, la borra y audita (slug y nombre). Conserva los pagos (ADR 0027). Solo service_role; vuelve a comprobar que p_actor es SuperAdmin y que p_slug es el de la organización.';

commit;
