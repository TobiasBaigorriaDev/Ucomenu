-- Rol de cocinero (ficha agile/cambios/rol-cocinero.md, ADR 0048), sobre 20261128100000 (estados de línea) y 20261021110000 (disponibilidad).
--
-- Qué hace:
--  * `memberships.role` admite `cook`.
--  * CERRADO POR DEFECTO: `private.is_org_member` pasa a significar Dueño o Staff. Las más de 130 políticas y todas las funciones del
--    mozo (`can_take_orders`, `close_order`, `void_order`, …) lo usan: un cocinero no hereda nada de lo anterior. Lo de cocina se
--    concede aparte con `private.is_org_kitchen` (Dueño, Staff o cocinero) y `private.can_kitchen_orders` (además, `orders` en el plan).
--  * `order_items.status` suma `ready` (listo para entregar). Flujo: noted → ready → delivered; `in_kitchen` queda válido para lo
--    existente (la pantalla del mozo ya no lo ofrece) y puede pasar a `ready`. Deshacer: ready → noted.
--  * `set_order_item_status`: el cocinero solo puede pasar a `ready` y deshacerlo a `noted`; Dueño y Staff, todo como antes.
--  * Cuatro funciones SECURITY DEFINER para el cocinero (sin acceso directo a tablas): `kitchen_orders` (pedidos abiertos con sus líneas
--    pendientes, SIN precios ni totales), `kitchen_branches` (sucursales activas: id y nombre), `kitchen_menu` (platos activos y
--    visibles de una sucursal, SIN precios) y `set_kitchen_availability` (escribe SOLO `is_available` de esa sucursal, con la cuenta
--    editable).
--  * `register_push_subscription` exige Dueño o Staff (el cocinero no recibe avisos de llamados) y un trigger borra las suscripciones
--    push de quien pasa a cocinero.
--
-- Errores estables (el mensaje es el nombre): 42501 orders_not_allowed · P0002 item_not_found / branch_not_found / product_not_found ·
-- 22023 invalid_status / invalid_transition / invalid_reason / reason_required / invalid_availability. Repetir devuelve `unchanged`.
--
-- Aditiva, sin datos que migrar. Rollback (local): git revert + `pnpm db:reset`. Con datos reales, en una transacción y en este orden:
--   1. pasar los cocineros a `staff` (o quitarlos): `update public.memberships set role = 'staff' where role = 'cook';`
--   2. devolver las líneas listas: `update public.order_items set status = 'noted' where status = 'ready';`
--   3. volver a poner `check (role in ('owner','staff'))` y el `check` de estados de 20261128100000, `drop function` de las funciones de
--      cocina, restaurar `is_org_member` (20261030100000), `set_order_item_status` (20261128100000) y `register_push_subscription`
--      (20261025100000); `drop trigger memberships_cook_no_push on public.memberships`.

begin;

-- ---------------------------------------------------------------------------
-- Rol
-- ---------------------------------------------------------------------------

alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'staff', 'cook'));
comment on table public.memberships is
  'Usuario ↔ organización con rol owner | staff | cook. Fuente única de autorización (ADR 0005, ADR 0048). Solo escribe el servidor.';

-- ---------------------------------------------------------------------------
-- Funciones de autorización
-- ---------------------------------------------------------------------------

-- Dueño o Staff (NO el cocinero): todo lo que ya existía queda cerrado para el rol nuevo.
create or replace function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'staff')
      and o.is_active
  );
$$;

create function private.is_org_cook(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role = 'cook'
      and o.is_active
  );
$$;

-- Quien trabaja en cocina: Dueño, Staff o cocinero.
create function private.is_org_kitchen(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(org_id) or private.is_org_cook(org_id);
$$;

-- ... y con la función `orders` en el plan y la cuenta al día (`has_feature` ya excluye solo lectura y suspendida).
create function private.can_kitchen_orders(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_kitchen(org_id) and private.has_feature(org_id, 'orders');
$$;

-- ¿Puede quien llama llevar una línea de esta organización a `p_status`? Dueño y Staff, a cualquiera (como hasta ahora); el cocinero,
-- solo a `ready` y de vuelta a `noted`.
create function private.can_set_item_status(org_id uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_take_orders(org_id)
      or (p_status in ('ready', 'noted') and private.is_org_cook(org_id) and private.has_feature(org_id, 'orders'));
$$;

revoke all on function
  private.is_org_cook(uuid), private.is_org_kitchen(uuid), private.can_kitchen_orders(uuid), private.can_set_item_status(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Estado «listo»
-- ---------------------------------------------------------------------------

alter table public.order_items drop constraint order_items_status_check;
alter table public.order_items
  add constraint order_items_status_check check (status in ('noted', 'in_kitchen', 'ready', 'delivered', 'cancelled'));

create or replace function public.set_order_item_status(p_item uuid, p_status text, p_reason text default null)
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
  -- Antes de mirar nada más: quien no trabaja en el local (o no tiene plan o cuenta al día) no aprende qué hay adentro.
  if not private.can_kitchen_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('noted', 'in_kitchen', 'ready', 'delivered', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  -- El cocinero solo marca listo (y deshace): lo demás es del mozo.
  if not private.can_set_item_status(v_org, p_status) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and (char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  -- El candado del pedido primero (el mismo orden que add_order_item), después el de la línea.
  select o.status into v_order_status from public.orders o where o.id = v_order for update;
  -- Esperar el candado puede llevar tiempo: se vuelve a comprobar quién llama.
  if not private.can_set_item_status(v_org, p_status) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select i.* into v_item from public.order_items i where i.id = p_item for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  -- El candado de la línea es OTRA espera (la retiene, por ejemplo, el borrado de un plato): se vuelve a comprobar quién llama.
  if not private.can_set_item_status(v_org, p_status) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;

  if v_item.status = p_status then
    return jsonb_build_object('order_id', v_order, 'item_id', p_item, 'status', v_item.status, 'unchanged', true);
  end if;
  if v_order_status <> 'open' then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  if v_item.status = 'cancelled'
     or (p_status = 'in_kitchen' and v_item.status <> 'noted')
     or (p_status = 'ready' and v_item.status not in ('noted', 'in_kitchen'))
     or (p_status = 'delivered' and v_item.status not in ('noted', 'in_kitchen', 'ready'))
     or (p_status = 'noted' and v_item.status <> 'ready') then
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
  'Cambia el estado de una línea (noted → ready → delivered; in_kitchen heredado; cancelled desde cualquiera, con motivo si ya se entregó; ready → noted deshace). Dueño y Staff, todos; el cocinero solo ready y noted. Con la función orders en el plan y la cuenta al día, con el pedido abierto. Repetir devuelve unchanged.';

-- ---------------------------------------------------------------------------
-- Lo que lee y escribe el cocinero
-- ---------------------------------------------------------------------------

-- Pedidos abiertos con sus líneas pendientes (anotadas, en cocina o listas). Sin precios, totales ni datos de cobro.
create function public.kitchen_orders(p_org uuid, p_branch uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_orders jsonb;
begin
  if (select auth.uid()) is null or not private.can_kitchen_orders(p_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(s.entry order by s.opened_at, s.id), '[]'::jsonb)
    into v_orders
  from (
    select o.id, o.opened_at,
           jsonb_build_object(
             'order_id', o.id,
             'table_label', o.table_label,
             'branch_id', o.branch_id,
             'branch_name', b.name,
             'opened_at', o.opened_at,
             'items', (
               select jsonb_agg(
                        jsonb_build_object(
                          'id', i.id,
                          'name', i.product_name,
                          'quantity', i.quantity,
                          'note', i.note,
                          'status', i.status,
                          'created_at', i.created_at,
                          'options', coalesce(
                            (select jsonb_agg(jsonb_build_object('group', x.group_name, 'option', x.option_name) order by x.created_at, x.id)
                               from public.order_item_options x where x.order_item_id = i.id),
                            '[]'::jsonb)
                        )
                        order by i.created_at, i.id
                      )
               from public.order_items i
               where i.order_id = o.id and i.organization_id = o.organization_id and i.status in ('noted', 'in_kitchen', 'ready')
             )
           ) as entry
    from public.orders o
    join public.branches b on b.id = o.branch_id and b.organization_id = o.organization_id
    where o.organization_id = p_org
      and o.status = 'open'
      and (p_branch is null or o.branch_id = p_branch)
      and exists (
        select 1 from public.order_items i
        where i.order_id = o.id and i.organization_id = o.organization_id and i.status in ('noted', 'in_kitchen', 'ready')
      )
    order by o.opened_at, o.id
    limit 200
  ) s;

  return jsonb_build_object('server_now', clock_timestamp(), 'orders', v_orders);
end;
$$;
comment on function public.kitchen_orders(uuid, uuid) is
  'Pedidos abiertos de la organización (de una sucursal o de todas) con sus líneas anotadas, en cocina o listas: mesa, plato, cantidad, opciones y observación. Sin precios ni totales. Dueño, Staff o cocinero con orders en el plan y la cuenta al día.';

-- Sucursales activas del local (id y nombre) para elegir de cuál se ven los pedidos o se agotan los platos.
create function public.kitchen_branches(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.can_kitchen_orders(p_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name, b.id)
       from public.branches b where b.organization_id = p_org and b.is_active),
    '[]'::jsonb);
end;
$$;
comment on function public.kitchen_branches(uuid) is
  'Sucursales activas de la organización (id y nombre). Dueño, Staff o cocinero con orders en el plan y la cuenta al día.';

-- Platos activos y visibles de una sucursal, por categoría, con su disponibilidad. Sin precios.
create function public.kitchen_menu(p_org uuid, p_branch uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_categories jsonb;
begin
  if (select auth.uid()) is null or not private.can_kitchen_orders(p_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.branches b where b.id = p_branch and b.organization_id = p_org and b.is_active) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(s.entry order by s.sort_order, s.name, s.id), '[]'::jsonb)
    into v_categories
  from (
    select c.id, c.name, c.sort_order,
           jsonb_build_object(
             'id', c.id,
             'name', c.name,
             'products', (
               select jsonb_agg(
                        jsonb_build_object('id', p.id, 'name', p.name, 'available', coalesce(a.is_available, true))
                        order by p.sort_order, p.name, p.id
                      )
               from public.products p
               left join public.product_availability a on a.product_id = p.id and a.branch_id = p_branch and a.organization_id = p.organization_id
               where p.category_id = c.id and p.organization_id = c.organization_id and p.is_active and coalesce(a.is_visible, true)
             )
           ) as entry
    from public.categories c
    where c.organization_id = p_org
      and c.is_active
      and exists (
        select 1 from public.products p
        left join public.product_availability a on a.product_id = p.id and a.branch_id = p_branch and a.organization_id = p.organization_id
        where p.category_id = c.id and p.organization_id = c.organization_id and p.is_active and coalesce(a.is_visible, true)
      )
  ) s;

  return jsonb_build_object('categories', v_categories);
end;
$$;
comment on function public.kitchen_menu(uuid, uuid) is
  'Categorías activas con sus platos activos y visibles en la sucursal, y si están disponibles. Sin precios. Dueño, Staff o cocinero con orders en el plan y la cuenta al día.';

-- Agotado / disponible de un plato en una sucursal. Escribe SOLO `is_available`: nunca visibilidad ni precio.
create function public.set_kitchen_availability(p_org uuid, p_product uuid, p_branch uuid, p_available boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_available boolean;
begin
  if (select auth.uid()) is null or not private.can_kitchen_orders(p_org) or not private.org_can_write(p_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if p_available is null then
    raise exception 'invalid_availability' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches b where b.id = p_branch and b.organization_id = p_org and b.is_active) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product and p.organization_id = p_org and p.is_active) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  begin
    insert into public.product_availability (organization_id, branch_id, product_id, is_available)
    values (p_org, p_branch, p_product, p_available)
    on conflict (branch_id, product_id) do update set is_available = excluded.is_available
    returning is_available into v_available;
  exception when foreign_key_violation then
    -- El plato o la sucursal se borraron entre la comprobación y la escritura.
    raise exception 'product_not_found' using errcode = 'P0002';
  end;

  return jsonb_build_object('product_id', p_product, 'branch_id', p_branch, 'available', v_available);
end;
$$;
comment on function public.set_kitchen_availability(uuid, uuid, uuid, boolean) is
  'Marca un plato disponible o agotado en una sucursal (solo is_available). Dueño, Staff o cocinero con orders en el plan y la cuenta editable.';

revoke all on function
  public.kitchen_orders(uuid, uuid), public.kitchen_branches(uuid), public.kitchen_menu(uuid, uuid),
  public.set_kitchen_availability(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.kitchen_orders(uuid, uuid), public.kitchen_branches(uuid), public.kitchen_menu(uuid, uuid),
  public.set_kitchen_availability(uuid, uuid, uuid, boolean)
  to authenticated;
-- `create or replace` conserva los permisos de set_order_item_status (solo authenticated).

-- ---------------------------------------------------------------------------
-- Sin avisos push para el cocinero
-- ---------------------------------------------------------------------------

create or replace function public.register_push_subscription(p_org uuid, p_endpoint text, p_p256dh text, p_auth text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or p_org is null then
    return 'unavailable';
  end if;

  -- Dueño o Staff: el cocinero no atiende llamados y no recibe sus avisos.
  if not exists (
    select 1 from public.memberships m where m.user_id = v_user and m.organization_id = p_org and m.role in ('owner', 'staff')
  ) or not private.has_feature(p_org, 'waiter_call') then
    return 'unavailable';
  end if;

  if p_endpoint is null or length(p_endpoint) > 1000 or not private.is_push_endpoint(p_endpoint)
     or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{86,88}$'
     or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22,24}$' then
    return 'invalid';
  end if;

  -- Tope por persona y local (un teléfono y una PC son dos; diez cubre de sobra y frena el abuso). El lock serializa los
  -- registros de la misma persona y local: sin él, dos pedidos simultáneos contarían los mismos nueve y terminarían en once.
  perform pg_advisory_xact_lock(hashtextextended('push_subscription:' || v_user::text || ':' || p_org::text, 0));
  if (
    select count(*) from public.push_subscriptions s
    where s.user_id = v_user and s.organization_id = p_org and s.endpoint <> p_endpoint
  ) >= 10 then
    return 'limit';
  end if;

  -- Si el mismo dispositivo ya estaba registrado por otra persona (cambio de cuenta en la misma PC), pasa a quien lo usa ahora.
  insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth_secret)
  values (p_org, v_user, p_endpoint, p_p256dh, p_auth)
  on conflict (organization_id, endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        registered_at = now();

  return 'ok';
end;
$$;
comment on function public.register_push_subscription(uuid, text, text, text) is
  'Registra el dispositivo de quien llama para recibir avisos de llamados de p_org (Dueño o Staff, plan y cuenta al día; endpoint de un servicio de push conocido). ok | unavailable | invalid | limit.';

-- Quien pasa a cocinero deja de recibir avisos de llamados de ese local (las suscripciones que ya tenía).
create function private.cook_drops_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions s where s.user_id = new.user_id and s.organization_id = new.organization_id;
  return null;
end;
$$;
revoke all on function private.cook_drops_push() from public, anon, authenticated;

create trigger memberships_cook_no_push
  after update of role on public.memberships
  for each row
  when (new.role = 'cook' and old.role is distinct from new.role)
  execute function private.cook_drops_push();

commit;
