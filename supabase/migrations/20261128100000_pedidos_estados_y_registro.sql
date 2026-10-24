-- Estados, modificar y cancelar líneas, cerrar y anular pedidos, con registro de solo-agregado (ficha
-- agile/cambios/pedidos-estados-y-registro.md, ADR 0041 decisiones 3 y 5), sobre 20261126100000 y 20261127100000.
--
-- Qué hace:
--  * `order_items.status` pasa a `noted | in_kitchen | delivered | cancelled` (+ `cancel_reason`); `orders` gana `void_reason` y
--    `closed_by`. Las tablas siguen sin escritura por la API (tampoco `service_role`): se escribe solo con funciones.
--  * Cuatro funciones (`SECURITY DEFINER`, solo `authenticated`): `set_order_item_status`, `update_order_item` (cantidad y
--    observación de una línea `noted`), `close_order` y `void_order`. Cambiar estados, modificar y cancelar exigen un miembro con
--    la función `orders` en el plan y la cuenta al día; CERRAR y ANULAR solo exigen ser miembro (nunca se bloquean por mora, por
--    suspensión ni por baja de plan). Cada una toma el candado del pedido primero y vuelve a comprobar quién llama tras esperarlo.
--  * `order_events`: registro de SOLO-AGREGADO escrito por triggers de `orders` y `order_items` (persona, hora y detalle). Sin clave
--    foránea al pedido, a la línea ni a la persona; clave RESTRICT a la organización: se purga con el borrado de la organización
--    (`private.purge_organization_order_events`, que llama `admin_delete_organization`, ahora con su cifra).
--
-- Errores estables (el mensaje es el nombre): 42501 orders_not_allowed · P0002 item_not_found / order_not_found · 22023
-- invalid_status / invalid_transition / invalid_reason / reason_required / invalid_quantity / invalid_note · 55000 order_not_open /
-- item_not_editable. Repetir una transición ya aplicada devuelve `unchanged: true` sin escribir ni registrar.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos reales: `drop function` de las cuatro funciones; las columnas y
-- el `check` de estados se pueden dejar. Si `order_events` tiene filas se CONSERVA junto con `private.purge_organization_order_events`
-- y ESTA versión de `admin_delete_organization` (la anterior no lo purga y el borrado de esas organizaciones fallaría por el RESTRICT);
-- sin filas: `drop table public.order_events; drop function private.record_order_event(), private.order_events_append_only(),
-- private.purge_organization_order_events(uuid);` y volver a crear `admin_delete_organization` con el cuerpo de 20261123100000.

begin;

-- ---------------------------------------------------------------------------
-- Columnas y estados
-- ---------------------------------------------------------------------------

alter table public.order_items drop constraint order_items_status_check;
alter table public.order_items
  add column cancel_reason text,
  add constraint order_items_status_check check (status in ('noted', 'in_kitchen', 'delivered', 'cancelled')),
  add constraint order_items_cancel_reason_check check (
    cancel_reason is null
    or (status = 'cancelled' and cancel_reason = btrim(cancel_reason) and char_length(cancel_reason) between 1 and 200 and cancel_reason !~ '[[:cntrl:]]')
  );

alter table public.orders
  add column void_reason text,
  add column closed_by uuid references auth.users (id) on delete set null,
  add constraint orders_void_reason_check check (
    (status = 'void') = (void_reason is not null)
    and (void_reason is null or (void_reason = btrim(void_reason) and char_length(void_reason) between 1 and 200 and void_reason !~ '[[:cntrl:]]'))
  );

-- ---------------------------------------------------------------------------
-- Registro de solo-agregado
-- ---------------------------------------------------------------------------

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: una organización con registro no se borra sin pasar por su purga (admin_delete_organization).
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Sin clave foránea a propósito: el registro sobrevive al pedido, a la línea y a la persona.
  order_id uuid not null,
  item_id uuid,
  event text not null
    check (event in ('order.opened', 'item.added', 'item.status_changed', 'item.edited', 'order.closed', 'order.voided')),
  -- auth.uid() de la sesión; NULL = operación técnica sin usuario.
  actor_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  detail jsonb not null default '{}'::jsonb
);
comment on table public.order_events is
  'Registro de solo-agregado de los pedidos (ADR 0041), escrito solo por trigger. Sin escritura por la API ni service_role; UPDATE, DELETE y TRUNCATE fallan. Se purga con el borrado de la organización.';
create index order_events_order_idx on public.order_events (order_id, occurred_at);
create index order_events_organization_idx on public.order_events (organization_id, occurred_at desc);

alter table public.order_events enable row level security;
revoke all on table public.order_events from anon, authenticated;
create policy "order_events: lectura de miembros"
  on public.order_events for select to authenticated
  using (private.is_org_member(organization_id));
grant select on table public.order_events to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.order_events from service_role;

-- Lo escriben triggers SECURITY DEFINER: la API no tiene INSERT. Corren con el pedido de la persona, así que (select auth.uid())
-- es la identidad de la sesión. Solo registran lo que cambia de verdad; los cambios internos (el total de opciones que calcula
-- add_order_item, un plato o una mesa borrados) no son eventos.
create function private.record_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_table_name = 'orders' then
    if tg_op = 'INSERT' then
      insert into public.order_events (organization_id, order_id, event, actor_id, detail)
      values (new.organization_id, new.id, 'order.opened', v_actor,
              jsonb_build_object('table_label', new.table_label, 'branch_id', new.branch_id));
    elsif new.status is distinct from old.status then
      insert into public.order_events (organization_id, order_id, event, actor_id, detail)
      values (new.organization_id, new.id,
              case new.status when 'void' then 'order.voided' else 'order.closed' end, v_actor,
              case new.status when 'void' then jsonb_build_object('reason', new.void_reason) else '{}'::jsonb end);
    end if;
  elsif tg_op = 'INSERT' then
    insert into public.order_events (organization_id, order_id, item_id, event, actor_id, detail)
    values (new.organization_id, new.order_id, new.id, 'item.added', v_actor,
            jsonb_build_object('product_name', new.product_name, 'quantity', new.quantity,
                               'base_price_cents', new.base_price_cents, 'unit_price_cents', new.unit_price_cents));
  else
    if new.status is distinct from old.status then
      insert into public.order_events (organization_id, order_id, item_id, event, actor_id, detail)
      values (new.organization_id, new.order_id, new.id, 'item.status_changed', v_actor,
              jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.cancel_reason));
    end if;
    if new.quantity is distinct from old.quantity or new.note is distinct from old.note then
      insert into public.order_events (organization_id, order_id, item_id, event, actor_id, detail)
      values (new.organization_id, new.order_id, new.id, 'item.edited', v_actor,
              jsonb_build_object('quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity),
                                 'note', jsonb_build_object('from', old.note, 'to', new.note)));
    end if;
  end if;
  return null;
end;
$$;

create trigger orders_record_insert after insert on public.orders
  for each row execute function private.record_order_event();
create trigger orders_record_update after update of status on public.orders
  for each row execute function private.record_order_event();
create trigger order_items_record_insert after insert on public.order_items
  for each row execute function private.record_order_event();
create trigger order_items_record_update after update of status, quantity, note on public.order_items
  for each row execute function private.record_order_event();

create function private.order_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order_events es de solo agregado (% rechazado)', tg_op
    using errcode = '42501';
end;
$$;

create trigger order_events_no_update_delete
  before update or delete on public.order_events
  for each row execute function private.order_events_append_only();
create trigger order_events_no_truncate
  before truncate on public.order_events
  for each statement execute function private.order_events_append_only();

-- Purga del registro de una organización que se borra. SIN EXECUTE para ningún rol: la llama `admin_delete_organization` DESPUÉS de
-- `purge_organization_price_history`, que exige la baja auditada de 30 días o más. Aun así rechaza una organización que sigue activa.
create function private.purge_organization_order_events(p_org uuid)
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

  alter table public.order_events disable trigger order_events_no_update_delete;
  delete from public.order_events where organization_id = p_org;
  get diagnostics v_deleted = row_count;
  alter table public.order_events enable trigger order_events_no_update_delete;

  return v_deleted;
end;
$$;
comment on function private.purge_organization_order_events(uuid) is
  'Purga el registro de pedidos de una organización dada de baja. Apaga el trigger de solo-agregado dentro de la transacción. Sin EXECUTE para ningún rol de la API: solo la llama admin_delete_organization.';

revoke all on function private.record_order_event(), private.order_events_append_only(), private.purge_organization_order_events(uuid)
  from public, anon, authenticated, service_role;

-- Borrado de organizaciones: misma función de 20261123100000 con la purga del registro de pedidos y su cifra.
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
  v_orders_purged integer;
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
  -- El registro de pedidos (ADR 0041) también, en la misma transacción y después de la misma comprobación.
  v_orders_purged := private.purge_organization_order_events(p_org);

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
      'order_events_purged', v_orders_purged,
      'branches', v_branches,
      'products', v_products,
      'memberships', v_memberships,
      'payments_kept', v_payments,
      'voids_kept', v_voids
    )
  );

  return jsonb_build_object(
    'price_history_purged', v_purged, 'promotion_history_purged', v_promo_purged, 'order_events_purged', v_orders_purged, 'payments_kept', v_payments
  );
end;
$$;
comment on function public.admin_delete_organization(uuid, uuid, text, text) is
  'Borra definitivamente una organización dada de baja hace 30 días o más: purga su historial de precios, el de promociones y el registro de pedidos, la borra y audita (slug y nombre). Conserva los pagos (ADR 0027). Solo service_role; vuelve a comprobar que p_actor es SuperAdmin y que p_slug es el de la organización.';

-- ---------------------------------------------------------------------------
-- Estados de una línea
-- ---------------------------------------------------------------------------

create function public.set_order_item_status(p_item uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_order uuid;
  v_order_status text;
  v_reason text;
  v_item public.order_items%rowtype;
begin
  if v_uid is null then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select i.organization_id, i.order_id into v_org, v_order from public.order_items i where i.id = p_item;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  -- Antes de mirar nada más: quien no es miembro (o no tiene plan o cuenta al día) no aprende qué hay adentro.
  if not private.can_take_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('in_kitchen', 'delivered', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and (char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  -- El candado del pedido primero (el mismo orden que add_order_item), después el de la línea.
  select o.status into v_order_status from public.orders o where o.id = v_order for update;
  -- Esperar el candado puede llevar tiempo: se vuelve a comprobar quién llama.
  if not private.can_take_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select i.* into v_item from public.order_items i where i.id = p_item for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  if v_item.status = p_status then
    return jsonb_build_object('order_id', v_order, 'item_id', p_item, 'status', v_item.status, 'unchanged', true);
  end if;
  if v_order_status <> 'open' then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  if v_item.status = 'cancelled'
     or (p_status = 'in_kitchen' and v_item.status <> 'noted')
     or (p_status = 'delivered' and v_item.status not in ('noted', 'in_kitchen')) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if p_status = 'cancelled' and v_item.status = 'delivered' and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.order_items
  set status = p_status, cancel_reason = case when p_status = 'cancelled' then v_reason else cancel_reason end
  where id = p_item
  returning * into v_item;

  return jsonb_build_object('order_id', v_order, 'item_id', p_item, 'status', v_item.status, 'unchanged', false);
end;
$$;
comment on function public.set_order_item_status(uuid, text, text) is
  'Cambia el estado de una línea (noted → in_kitchen → delivered, o cancelled desde cualquiera; cancelar una entregada exige motivo). Solo un miembro con la función en el plan y la cuenta al día, con el pedido abierto. Repetir devuelve unchanged.';

create function public.update_order_item(p_item uuid, p_quantity integer, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_order uuid;
  v_order_status text;
  v_note text;
  v_item public.order_items%rowtype;
begin
  if v_uid is null then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select i.organization_id, i.order_id into v_org, v_order from public.order_items i where i.id = p_item;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if not private.can_take_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and (char_length(v_note) > 200 or v_note ~ '[[:cntrl:]]') then
    raise exception 'invalid_note' using errcode = '22023';
  end if;

  select o.status into v_order_status from public.orders o where o.id = v_order for update;
  if not private.can_take_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select i.* into v_item from public.order_items i where i.id = p_item for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_order_status <> 'open' then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  if v_item.status <> 'noted' then
    raise exception 'item_not_editable' using errcode = '55000';
  end if;

  if v_item.quantity = p_quantity and v_item.note is not distinct from v_note then
    return jsonb_build_object('order_id', v_order, 'item_id', p_item, 'quantity', v_item.quantity, 'note', v_item.note, 'unchanged', true);
  end if;
  update public.order_items set quantity = p_quantity, note = v_note where id = p_item returning * into v_item;
  return jsonb_build_object('order_id', v_order, 'item_id', p_item, 'quantity', v_item.quantity, 'note', v_item.note, 'unchanged', false);
end;
$$;
comment on function public.update_order_item(uuid, integer, text) is
  'Cambia la cantidad y la observación de una línea anotada (noted) de un pedido abierto; el precio y las opciones no se recalculan. Solo un miembro con la función en el plan y la cuenta al día. Sin cambios devuelve unchanged.';

-- ---------------------------------------------------------------------------
-- Cerrar y anular un pedido (nunca se bloquean por mora ni por plan)
-- ---------------------------------------------------------------------------

create function public.close_order(p_order uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select o.organization_id into v_org from public.orders o where o.id = p_order;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  -- Solo ser miembro: cerrar nunca depende del plan ni de la mora (ADR 0041, decisión 5).
  if not private.is_org_member(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select o.status into v_status from public.orders o where o.id = p_order for update;
  if not private.is_org_member(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('order_id', p_order, 'status', v_status, 'unchanged', true);
  end if;
  if v_status <> 'open' then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  update public.orders set status = 'closed', closed_at = clock_timestamp(), closed_by = v_uid where id = p_order;
  return jsonb_build_object('order_id', p_order, 'status', 'closed', 'unchanged', false);
end;
$$;
comment on function public.close_order(uuid) is
  'Cierra un pedido abierto. Solo ser miembro de la organización: nunca se bloquea por mora, suspensión ni plan (ADR 0041). Repetir devuelve unchanged.';

create function public.void_order(p_order uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_status text;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select o.organization_id into v_org from public.orders o where o.id = p_order;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if not private.is_org_member(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select o.status into v_status from public.orders o where o.id = p_order for update;
  if not private.is_org_member(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if v_status = 'void' then
    return jsonb_build_object('order_id', p_order, 'status', v_status, 'unchanged', true);
  end if;
  if v_status <> 'open' then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  update public.orders
  set status = 'void', closed_at = clock_timestamp(), closed_by = v_uid, void_reason = v_reason
  where id = p_order;
  return jsonb_build_object('order_id', p_order, 'status', 'void', 'unchanged', false);
end;
$$;
comment on function public.void_order(uuid, text) is
  'Anula un pedido abierto, con motivo. Solo ser miembro de la organización: nunca se bloquea por mora, suspensión ni plan (ADR 0041). Repetir devuelve unchanged.';

revoke all on function
  public.set_order_item_status(uuid, text, text), public.update_order_item(uuid, integer, text),
  public.close_order(uuid), public.void_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.set_order_item_status(uuid, text, text), public.update_order_item(uuid, integer, text),
  public.close_order(uuid), public.void_order(uuid, text)
  to authenticated;

commit;
