-- Propina sugerida por sucursal. Ficha: agile/cambios/propina-sugerida.md.
-- No altera consumo ni registra cobros. RLS vigente: Dueño con cuenta al día.
begin;

alter table public.branches add column tip_percent smallint
  constraint branches_tip_percent_check check (tip_percent between 1 and 100);
comment on column public.branches.tip_percent is
  'Propina sugerida vigente: entero 1–100; null la desactiva. No representa cobros.';
grant select (tip_percent), update (tip_percent) on public.branches to authenticated;

-- Mismos controles y proyección que 20261201100000; suma solo el porcentaje de la sucursal.
create or replace function public.get_table_account(p_token text, p_ticket_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_table record;
  v_order uuid;
  v_lines jsonb;
  v_total bigint;
  v_dishes bigint;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' or p_ticket_at is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select t.id, t.label, t.turn_started_at, b.name as branch_name,
         b.timezone as time_zone, b.tip_percent, o.name as org_name
    into v_table
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where t.qr_token = p_token and t.is_active and b.is_active and o.is_active
    and private.has_feature(o.id, 'waiter_call');
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not private.ticket_in_turn(v_table.id, p_ticket_at)
     or not exists (
       select 1 from public.waiter_calls c
       where c.table_id = v_table.id and c.kind = 'bill'
         and c.status in ('pending', 'attended')
         and c.created_at > v_table.turn_started_at
     ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select o.id into v_order from public.orders o where o.table_id = v_table.id and o.status = 'open';
  if not found then
    return jsonb_build_object('status', 'empty');
  end if;

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'quantity', i.quantity, 'name', i.product_name,
        'options', coalesce(
          (select jsonb_agg(op.option_name order by op.created_at, op.id)
           from public.order_item_options op where op.order_item_id = i.id), '[]'::jsonb),
        'unit_cents', i.unit_price_cents + i.options_cents,
        'line_cents', i.quantity * (i.unit_price_cents + i.options_cents)
      ) order by i.created_at, i.id
    ), '[]'::jsonb),
    coalesce(sum(i.quantity * (i.unit_price_cents + i.options_cents)), 0),
    coalesce(sum(i.quantity), 0)
    into v_lines, v_total, v_dishes
  from public.order_items i
  where i.order_id = v_order and i.status <> 'cancelled';

  return jsonb_build_object(
    'status', 'ok', 'org_name', v_table.org_name, 'branch_name', v_table.branch_name,
    'table_label', v_table.label, 'time_zone', v_table.time_zone, 'as_of', now(),
    'lines', v_lines, 'dishes', v_dishes, 'total_cents', v_total,
    'tip_percent', v_table.tip_percent
  );
end;
$$;
revoke all on function public.get_table_account(text, timestamptz) from public, anon, authenticated;
grant execute on function public.get_table_account(text, timestamptz) to service_role;

commit;
