-- Personal por sucursal, SOLO PANTALLA (nivel M; ficha agile/cambios/personal-por-sucursal.md).
--
-- El Dueño asigna sucursales a un Staff o a un cocinero; esa persona solo VE (pantallas de Sala y de Cocina y avisos push) lo de esas
-- sucursales. NO es una restricción de autorización: no cambia ninguna política RLS ni las funciones que ESCRIBEN (set_order_item_status,
-- set_kitchen_availability, atender llamados…). La restricción real es el ítem [C] del tablero.
--
--  * memberships.assigned_branch_ids: vacío = sin restricción. Solo la escribe el servidor (service_role) desde Personal; la API no
--    tiene UPDATE sobre memberships (ADR 0005).
--  * private.my_assigned_branches(org): las sucursales ACTIVAS asignadas a quien llama; '{}' si no está restringido (Dueño, sin
--    asignación o no es miembro). Si TODAS las asignadas se desactivaron devuelve un id imposible: falla cerrado, nunca «todas».
--  * my_branch_view(org): para quien está restringido, su preferencia dentro de lo asignado (o todo lo asignado).
--  * set_my_branch_view: rechaza ('invalid') sucursales no asignadas.
--  * my_branch_access(org) -> {view, assigned}: lo que leen las pantallas de Sala en una sola llamada.
--  * kitchen_branches / kitchen_orders / kitchen_menu: solo las sucursales asignadas.
--  * push_targets_for_call: no avisa a quien tiene asignadas otras sucursales.
--
-- Rollback (todo vuelve a verse en todas las sucursales). ORDEN: desplegar primero el código anterior (llama a my_branch_access);
-- después volver a crear my_branch_view, set_my_branch_view y push_targets_for_call con 20261207100000/20261106100000, y
-- kitchen_branches, kitchen_orders y kitchen_menu con 20261207100000; y recién entonces:
--   drop function public.my_branch_access(uuid);
--   drop function private.my_assigned_branches(uuid);
--   alter table public.memberships drop column assigned_branch_ids;

alter table public.memberships
  add column assigned_branch_ids uuid[] not null default '{}' check (cardinality(assigned_branch_ids) <= 50);
comment on column public.memberships.assigned_branch_ids is
  'Sucursales que el Staff o el cocinero ve en pantalla (vacío = todas; el Dueño nunca se restringe). Solo pantalla: no es un permiso (ficha personal-por-sucursal).';

-- ---------------------------------------------------------------------------
-- Qué sucursales tiene asignadas quien llama
-- ---------------------------------------------------------------------------

create function private.my_assigned_branches(org_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when m.role in ('staff', 'cook') and cardinality(m.assigned_branch_ids) > 0 then
          coalesce(
            (
              select array_agg(b.id order by b.id)
              from public.branches b
              where b.id = any (m.assigned_branch_ids) and b.organization_id = m.organization_id and b.is_active
            ),
            -- Todas las asignadas se desactivaron: un id que no es de ninguna sucursal, para que no se vea nada (nunca «todas»).
            array['00000000-0000-0000-0000-000000000000']::uuid[]
          )
        else '{}'::uuid[]
      end
      from public.memberships m
      where m.organization_id = org_id and m.user_id = (select auth.uid())
    ),
    '{}'::uuid[]
  );
$$;
revoke all on function private.my_assigned_branches(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vista efectiva y su escritura
-- ---------------------------------------------------------------------------

create or replace function public.my_branch_view(p_org uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.is_org_member(p_org) then '{}'::uuid[]
    when cardinality(private.my_assigned_branches(p_org)) = 0 then
      coalesce(
        (
          select array_agg(b.id order by b.id)
          from public.member_branch_views v
          join public.branches b on b.id = any (v.branch_ids) and b.organization_id = v.organization_id and b.is_active
          where v.user_id = (select auth.uid()) and v.organization_id = p_org
        ),
        '{}'::uuid[]
      )
    else
      -- Restringido: su preferencia dentro de lo asignado; sin preferencia válida, todo lo asignado.
      coalesce(
        (
          select array_agg(b.id order by b.id)
          from public.member_branch_views v
          join public.branches b on b.id = any (v.branch_ids) and b.organization_id = v.organization_id and b.is_active
          where v.user_id = (select auth.uid()) and v.organization_id = p_org
            and b.id = any (private.my_assigned_branches(p_org))
        ),
        private.my_assigned_branches(p_org)
      )
  end;
$$;
comment on function public.my_branch_view(uuid) is
  'La vista efectiva de quien llama en p_org: sus sucursales elegidas que siguen activas (dentro de las asignadas, si las tiene). Vacío = todas.';

create or replace function public.set_my_branch_view(p_org uuid, p_branches uuid[])
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ids uuid[] := coalesce(p_branches, '{}'::uuid[]);
  v_assigned uuid[];
begin
  if v_user is null or p_org is null or not private.is_org_member(p_org) then
    return 'unavailable';
  end if;
  v_assigned := private.my_assigned_branches(p_org);

  if cardinality(v_ids) > 50
     or exists (select 1 from unnest(v_ids) i group by i having count(*) > 1)
     or exists (
       select 1 from unnest(v_ids) i
       where not exists (
         select 1 from public.branches b where b.id = i and b.organization_id = p_org and b.is_active
       )
     )
     -- Quien tiene sucursales asignadas solo puede elegir entre ellas.
     or (cardinality(v_assigned) > 0 and exists (select 1 from unnest(v_ids) i where not (i = any (v_assigned)))) then
    return 'invalid';
  end if;

  insert into public.member_branch_views (user_id, organization_id, branch_ids)
  values (v_user, p_org, v_ids)
  on conflict (user_id, organization_id) do update
    set branch_ids = excluded.branch_ids, updated_at = now();

  return 'ok';
end;
$$;

-- Lo que leen las pantallas de Sala: la vista efectiva y las sucursales asignadas (vacío = sin restricción), en una sola llamada.
create function public.my_branch_access(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'view', to_jsonb(public.my_branch_view(p_org)),
    'assigned', to_jsonb(case when private.is_org_member(p_org) then private.my_assigned_branches(p_org) else '{}'::uuid[] end)
  );
$$;
comment on function public.my_branch_access(uuid) is
  'La vista efectiva de quien llama y sus sucursales asignadas (vacío = todas). Solo miembros: para los demás, ambas vacías.';
revoke all on function public.my_branch_access(uuid) from public, anon;
grant execute on function public.my_branch_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cocina: solo las sucursales asignadas
-- ---------------------------------------------------------------------------

create or replace function public.kitchen_orders(p_org uuid, p_branch uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_orders jsonb;
  v_assigned uuid[];
begin
  if (select auth.uid()) is null or not private.can_kitchen_orders(p_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  v_assigned := private.my_assigned_branches(p_org);

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
      and (cardinality(v_assigned) = 0 or o.branch_id = any (v_assigned))
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
  'Pedidos abiertos de la organización (de una sucursal o de todas; solo de las asignadas si la persona las tiene) con sus líneas anotadas, en cocina o listas: mesa, plato, cantidad, opciones y observación. Sin precios ni totales. Dueño, Staff o cocinero con orders en el plan y la cuenta al día.';

create or replace function public.kitchen_branches(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assigned uuid[];
begin
  if (select auth.uid()) is null or not private.can_kitchen_orders(p_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  v_assigned := private.my_assigned_branches(p_org);
  return coalesce(
    (select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name, b.id)
       from public.branches b
       where b.organization_id = p_org and b.is_active
         and (cardinality(v_assigned) = 0 or b.id = any (v_assigned))),
    '[]'::jsonb);
end;
$$;
comment on function public.kitchen_branches(uuid) is
  'Sucursales activas de la organización (id y nombre); solo las asignadas si la persona las tiene. Dueño, Staff o cocinero con orders en el plan y la cuenta al día.';

create or replace function public.kitchen_menu(p_org uuid, p_branch uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_categories jsonb;
  v_assigned uuid[];
begin
  if (select auth.uid()) is null or not private.can_kitchen_orders(p_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  v_assigned := private.my_assigned_branches(p_org);
  if not exists (select 1 from public.branches b where b.id = p_branch and b.organization_id = p_org and b.is_active)
     or (cardinality(v_assigned) > 0 and not (p_branch = any (v_assigned))) then
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
  'Categorías activas con sus platos activos y visibles en la sucursal, y si están disponibles. Sin precios. Solo de una sucursal asignada si la persona las tiene. Dueño, Staff o cocinero con orders en el plan y la cuenta al día.';

-- ---------------------------------------------------------------------------
-- push_targets_for_call: no avisa a quien tiene asignadas otras sucursales
-- ---------------------------------------------------------------------------

create or replace function public.push_targets_for_call(p_token text, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_multi boolean;
  v_subscriptions jsonb;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill')
     or p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;

  select t.id, t.organization_id, t.branch_id, t.label, b.name as branch_name, o.slug,
         substr(md5(t.id::text), 1, 12) as table_key
    into v_table
  from public.tables t
  join public.branches b on b.id = t.branch_id and b.is_active
  join public.organizations o on o.id = t.organization_id and o.is_active
  where t.qr_token = p_token
    and t.is_active;

  if not found or not private.has_feature(v_table.organization_id, 'waiter_call') then
    return null;
  end if;

  -- Solo por un llamado que acaba de crearse y sigue pendiente: esta función no sirve para avisar "porque sí".
  if not exists (
    select 1 from public.waiter_calls w
    where w.table_id = v_table.id
      and w.kind = p_kind
      and w.status = 'pending'
      and w.created_at > now() - interval '2 minutes'
  ) then
    return null;
  end if;

  select count(*) > 1 into v_multi
  from public.branches b
  where b.organization_id = v_table.organization_id and b.is_active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret)), '[]'::jsonb)
    into v_subscriptions
  from (
    select ps.id, ps.endpoint, ps.p256dh, ps.auth_secret
    from public.push_subscriptions ps
    -- Solo a quien hoy es Dueño o Staff (ADR 0048): un cocinero no recibe avisos de llamados aunque conserve una suscripción.
    join public.memberships m
      on m.user_id = ps.user_id and m.organization_id = ps.organization_id and m.role in ('owner', 'staff')
    left join public.member_branch_views v
      on v.user_id = ps.user_id and v.organization_id = ps.organization_id
    where ps.organization_id = v_table.organization_id
      -- Un Staff con sucursales asignadas solo recibe las de ellas (el Dueño, todas).
      and (m.role = 'owner' or cardinality(m.assigned_branch_ids) = 0 or v_table.branch_id = any (m.assigned_branch_ids))
      -- Se avisa si la persona no eligió sucursales, si eligió esta, o si ninguna de las que eligió (dentro de lo asignado) sigue
      -- activa (ante la duda, se avisa: un aviso de más es preferible a un llamado sin atender).
      and (
        v.user_id is null
        or cardinality(v.branch_ids) = 0
        or v_table.branch_id = any (v.branch_ids)
        or not exists (
          select 1 from public.branches vb
          where vb.id = any (v.branch_ids) and vb.organization_id = v.organization_id and vb.is_active
            and (m.role = 'owner' or cardinality(m.assigned_branch_ids) = 0 or vb.id = any (m.assigned_branch_ids))
        )
      )
    order by ps.registered_at desc
    limit 200
  ) s;

  return jsonb_build_object(
    'slug', v_table.slug,
    'table_label', v_table.label,
    'table_key', v_table.table_key,
    'branch_name', v_table.branch_name,
    'multi_branch', v_multi,
    'subscriptions', v_subscriptions
  );
end;
$$;
comment on function public.push_targets_for_call(text, text) is
  'Destinos del aviso de un llamado recién creado (pendiente de menos de 2 minutos): suscripciones de los Dueños y Staff de esa organización que miran la sucursal de la mesa (o todas; un Staff con sucursales asignadas solo las de ellas) y los datos del texto. Solo service_role.';
