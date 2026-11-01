-- Datos FICTICIOS para La Bestia, solo staging. Autorizados por el usuario el 2026-11-01.
-- Ejecutar exclusivamente con: supabase db query --linked --project-ref oasixhsdyigimwvcxtkx --file tools/ventas-bestia-staging.sql
-- No es una migración. No cambia catálogo, permisos, planes ni pedidos existentes.
-- Lote fijo identificable por table_label = 'Demo80d 20261101 Mesa N' e IDs md5 deterministas.
-- Los eventos técnicos quedan fechados al importar; las ventas tienen fechas históricas.
-- Aborta ante una segunda ejecución: no duplica el lote. Todo se confirma en una transacción.
begin;
set local statement_timeout = '60s';
do $$
begin
  if not exists (select 1 from public.organizations where id = 'b0000000-0000-4000-8000-000000000001' and slug = 'la-bestia')
     or not exists (select 1 from public.branches where id = 'b1000000-0000-4000-8000-000000000001' and organization_id = 'b0000000-0000-4000-8000-000000000001') then
    raise exception 'Destino incorrecto';
  end if;
  if exists (select 1 from public.orders where organization_id = 'b0000000-0000-4000-8000-000000000001' and table_label like 'Demo80d 20261101%') then
    raise exception 'El lote ya existe; no se repite';
  end if;
end $$;

create temporary table demo_orders on commit drop as
with days as (
  select d, (now() at time zone 'America/Argentina/Buenos_Aires')::date - d as day
  from generate_series(1,80) d
), volume as (
  select *, 22 + ((80-d)/5) + (d*7 % 13)
    + case when extract(isodow from day) in (5,6,7) then 28 else 0 end as n
  from days
)
select md5('bestia-demo80d-20261101-order-'||d||'-'||j)::uuid as id,
  d, j, day,
  ((day + make_time(case when j%5=0 then 12+j%3 else 18+j%4 end, (j*13+d)%60,0))
    at time zone 'America/Argentina/Buenos_Aires') as opened_at,
  (25+(j*17+d)%80) as minutes,
  (j+d)%23=0 as voided
from volume cross join lateral generate_series(1,n) j;

insert into public.orders(id,organization_id,branch_id,table_label,opened_at)
select id,'b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  'Demo80d 20261101 Mesa '||(1+j%12),opened_at
from demo_orders;

create temporary table demo_products on commit drop as
select *,row_number() over(order by id)::integer as rn
from public.products where organization_id='b0000000-0000-4000-8000-000000000001' and is_active;

-- Dos platos quedan sin ventas para probar esa lista; La Bestia y Clásica tienen más demanda.
insert into public.order_items(id,organization_id,order_id,product_id,product_name,quantity,
  base_price_cents,unit_price_cents,status,cancel_reason,client_key,request_hash,created_at,note)
select md5('bestia-demo80d-20261101-item-'||o.d||'-'||o.j||'-'||k)::uuid,
  'b0000000-0000-4000-8000-000000000001',o.id,p.id,p.name,
  (1+(o.j+k)%3)::smallint,p.price_cents,
  case when (o.j+k+o.d)%7=0 then (p.price_cents*0.85)::integer else p.price_cents end,
  case when k=4 and (o.j+o.d)%9=0 then 'cancelled' else 'delivered' end,
  case when k=4 and (o.j+o.d)%9=0 then
    (array['Cambio de elección','Error al tomar el pedido','Demora en cocina'])[1+o.j%3] else null end,
  md5('bestia-demo80d-20261101-key-'||o.d||'-'||o.j||'-'||k)::uuid,
  md5('bestia-demo80d-20261101-request-'||o.d||'-'||o.j||'-'||k),
  o.opened_at+make_interval(mins=>k),'Venta ficticia - lote demo80d 20261101'
from demo_orders o cross join lateral generate_series(1,3+o.j%3) k
join demo_products p on p.rn = case when k=1 and o.j%3<>0 then 1+o.j%2
  else 1+(o.j*7+o.d*3+k*11)%greatest(1,(select count(*)::integer-2 from demo_products)) end;

update public.orders o set
  status=case when d.voided then 'void' else 'closed' end,
  closed_at=d.opened_at+make_interval(mins=>d.minutes),
  void_reason=case when d.voided then
    (array['Pedido duplicado','Cliente se retiró','Prueba de atención'])[1+d.j%3] else null end
from demo_orders d where o.id=d.id and o.organization_id='b0000000-0000-4000-8000-000000000001';

-- Vistas por plato y día para probar conversión y platos vistos sin ventas.
-- Conserva los contadores que ya existían, sin sumarlos ni sobrescribirlos.
insert into public.dish_view_counts(organization_id,branch_id,product_id,day,views)
select 'b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',p.id,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date-d,
  20+(p.rn*13+d*7)%85+case when p.rn<=2 then 130 else 0 end
from demo_products p cross join generate_series(1,80) d
on conflict(branch_id,product_id,day) do nothing;

do $$
declare n integer; result jsonb;
begin
  if (select count(distinct (closed_at at time zone 'America/Argentina/Buenos_Aires')::date)
      from public.orders where id in (select id from demo_orders)) <> 80 then
    raise exception 'No cubre exactamente 80 días';
  end if;
  if exists(select 1 from public.orders where id in (select id from demo_orders) and (status='open' or closed_at>now())) then
    raise exception 'Pedido abierto o futuro';
  end if;
  perform set_config('request.jwt.claim.sub',(select user_id::text from public.memberships
    where organization_id='b0000000-0000-4000-8000-000000000001' and role='owner' limit 1),true);
  foreach n in array array[7,30,90] loop
    result:=public.owner_sales_overview('b0000000-0000-4000-8000-000000000001',n);
    if result is null or (result#>>'{current,orders}')::integer<1 then
      raise exception 'Analítica sin ventas para % días',n;
    end if;
    if public.owner_products_performance('b0000000-0000-4000-8000-000000000001',n) is null then
      raise exception 'Analítica de platos no disponible';
    end if;
  end loop;
end $$;
commit;

select count(*) as pedidos, count(*) filter(where o.status='closed') as cerrados,
  count(*) filter(where o.status='void') as anulados,
  min((closed_at at time zone 'America/Argentina/Buenos_Aires')::date) as desde,
  max((closed_at at time zone 'America/Argentina/Buenos_Aires')::date) as hasta,
  (select count(*) from public.order_items i join public.orders x on x.id=i.order_id
    where x.organization_id='b0000000-0000-4000-8000-000000000001' and x.table_label like 'Demo80d 20261101%') as lineas
from public.orders o where organization_id='b0000000-0000-4000-8000-000000000001' and table_label like 'Demo80d 20261101%';
