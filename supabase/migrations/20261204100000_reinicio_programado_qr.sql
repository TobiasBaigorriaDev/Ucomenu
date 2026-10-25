-- Reinicio diario por sucursal y reinicio manual de todo el local.
-- Ficha: agile/cambios/reinicio-programado-qr.md. No cambia QR ni pedidos.
begin;

create function private.valid_qr_reset_times(p_times time[])
returns boolean language sql immutable set search_path = '' as $$
  select p_times is not null
    and cardinality(p_times) <= 24
    and coalesce(array_ndims(p_times), 1) = 1
    and not exists (select 1 from unnest(p_times) t where t is null or t >= time '24:00' or extract(second from t) <> 0)
    and cardinality(p_times) = (select count(distinct t) from unnest(p_times) t);
$$;
revoke all on function private.valid_qr_reset_times(time[]) from public, anon, authenticated;

alter table public.branches
  add column qr_reset_times time[] not null default array['05:00'::time],
  add column qr_reset_after timestamptz not null default now(),
  add constraint branches_qr_reset_times_check check (private.valid_qr_reset_times(qr_reset_times));
grant update (qr_reset_times) on public.branches to authenticated;
-- CHECK invoca una función privada: el rol necesita EXECUTE pero no accede a datos.
grant execute on function private.valid_qr_reset_times(time[]) to authenticated, service_role;

create function private.qr_schedule_changed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.qr_reset_times is distinct from old.qr_reset_times or new.timezone is distinct from old.timezone then
    new.qr_reset_after := clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function private.qr_schedule_changed() from public, anon, authenticated;
create trigger branches_qr_schedule_changed before update of qr_reset_times, timezone on public.branches
  for each row execute function private.qr_schedule_changed();

create function public.reset_all_table_turns(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_table uuid;
  v_count integer := 0;
begin
  if auth.uid() is null or not private.is_org_member(p_org) then
    raise exception 'tables_not_allowed' using errcode = '42501';
  end if;
  -- Misma secuencia de mesas que cron, incluidas sucursales inactivas.
  -- No bloquea sucursales: create_waiter_call toma advisory → sucursal FOR SHARE.
  for v_table in select id from public.tables where organization_id = p_org order by branch_id, id loop
    perform public.reset_table_turn(v_table);
    v_count := v_count + 1;
  end loop;
  if not private.is_org_member(p_org) then
    raise exception 'tables_not_allowed' using errcode = '42501';
  end if;
  return v_count;
end;
$$;
revoke all on function public.reset_all_table_turns(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reset_all_table_turns(uuid) to authenticated;

-- Solo el trabajo de postgres puede llamar al ejecutor (sin JWT ni suplantar una persona).
-- El instante es inyectable para pruebas; nunca se expone por la API.
create function private.run_scheduled_table_resets(p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  b record;
  v_due timestamptz;
  v_table uuid;
  v_count integer := 0;
begin
  -- Una ejecución a la vez, incluso si se invoca fuera de cron.
  perform pg_advisory_xact_lock(hashtextextended('scheduled_table_resets', 0));
  -- FOR SHARE serializa configuración/borrado, pero es compatible con el FOR SHARE
  -- de create_waiter_call. NO KEY UPDATE aquí invertiría sucursal → advisory.
  for b in select id, timezone, qr_reset_times, qr_reset_after from public.branches
    where is_active and cardinality(qr_reset_times) > 0 order by id for share loop
    select max((d.day::date + t.hour) at time zone b.timezone) into v_due
    from generate_series((p_now at time zone b.timezone)::date - 2,
                         (p_now at time zone b.timezone)::date, interval '1 day') d(day)
    cross join unnest(b.qr_reset_times) t(hour)
    where (d.day::date + t.hour) at time zone b.timezone <= p_now;
    if v_due is null or v_due <= b.qr_reset_after then continue; end if;

    -- Recupera solo el último horario pendiente. Usa hora de ejecución, igual que reinicio manual.
    for v_table in select id from public.tables where branch_id = b.id order by id loop
      perform 1 from public.tables where id = v_table for no key update;
      if not found then continue; end if;
      perform pg_advisory_xact_lock(hashtextextended('waiter_call:' || v_table::text, 0));
      update public.tables set turn_started_at = clock_timestamp() where id = v_table;
      update public.waiter_calls set status = 'expired' where table_id = v_table and kind = 'bill' and status = 'pending';
      v_count := v_count + 1;
    end loop;
    update public.branches set qr_reset_after = p_now where id = b.id;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.run_scheduled_table_resets(timestamptz) from public, anon, authenticated, service_role;

create extension if not exists pg_cron;
select cron.schedule('reset-scheduled-table-turns', '* * * * *', 'select private.run_scheduled_table_resets()');
commit;
