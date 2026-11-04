-- ADR 0054. No borra al aplicar la migración; cron procesa lotes después.
-- Reversión: select cron.unschedule('purge-expired-audit-log');
-- drop function private.purge_expired_audit_log(integer);
-- Los registros ya purgados solo se recuperan desde una copia válida.
create function private.purge_expired_audit_log(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  -- ALTER obtiene SHARE ROW EXCLUSIVE: ningún escritor puede aprovechar la ventana.
  -- Ante un error, PostgreSQL revierte también el cambio de estado del trigger.
  alter table public.audit_log disable trigger audit_log_no_update_delete;
  delete from public.audit_log a
  where a.id in (
    select candidate.id from public.audit_log candidate
    where candidate.created_at < statement_timestamp() - interval '10 years'
      and not exists (
        select 1 from public.organizations o where o.id = candidate.organization_id
      )
      -- Los ADR 0027/0028 identifican pagos huérfanos por esta auditoría.
      and not exists (select 1 from public.payments p where p.organization_id = candidate.organization_id)
      and not exists (select 1 from public.payment_voids v where v.organization_id = candidate.organization_id)
    order by candidate.created_at, candidate.id
    limit p_limit
  );
  get diagnostics v_deleted = row_count;
  alter table public.audit_log enable trigger audit_log_no_update_delete;
  return v_deleted;
end;
$$;
revoke all on function private.purge_expired_audit_log(integer) from public, anon, authenticated, service_role;
comment on function private.purge_expired_audit_log(integer) is
  'Solo mantenimiento interno: auditoría de más de 10 años sin organización, pagos ni anulaciones asociados, lote 1..5000. Preserva evidencias de baja y trazabilidad de pagos huérfanos (ADR 0054).';

select cron.schedule('purge-expired-audit-log', '30 7 * * *',
  $$select private.purge_expired_audit_log(1000);$$);
