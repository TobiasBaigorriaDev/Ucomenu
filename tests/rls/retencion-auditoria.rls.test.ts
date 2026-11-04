import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ORG_CAFE, sql } from "./helpers";

// Todo caso se revierte; no requiere apagar el trigger para limpiar fixtures.
const row = (id: string, age: string, org: string | null = null) =>
  `insert into public.audit_log (id, created_at, actor_id, actor_email, action, organization_id)
   values ('${id}', statement_timestamp() - interval '${age}', '${randomUUID()}',
     'audit-test@example.test', 'organization.created', ${org ? `'${org}'` : "null"});`;

describe("retención de auditoría", () => {
  it("no admite ejecución por ningún rol de API, ni siquiera service_role", () => {
    expect(sql(`select has_function_privilege('anon', 'private.purge_expired_audit_log(integer)', 'execute'),
      has_function_privilege('authenticated', 'private.purge_expired_audit_log(integer)', 'execute'),
      has_function_privilege('service_role', 'private.purge_expired_audit_log(integer)', 'execute')`)[0]).toEqual(["f", "f", "f"]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(() => sql(`begin; set local role ${role}; select private.purge_expired_audit_log(1); rollback;`)).toThrow(/permission denied/);
    }
  });

  it("purga por lote solo eventos vencidos sin local; conserva el límite exacto y la evidencia de locales existentes", () => {
    const old = randomUUID(), recent = randomUUID(), boundary = randomUUID(), active = randomUUID();
    const result = sql(`begin;
      ${row(old, "10 years 1 day")} ${row(recent, "9 years")}
      ${row(boundary, "10 years")} ${row(active, "11 years", ORG_CAFE)}
      select private.purge_expired_audit_log(1);
      select id from public.audit_log where id in ('${old}','${recent}','${boundary}','${active}') order by id;
      rollback;`);
    const ids = result.flat();
    expect(ids).not.toContain(old);
    expect(ids).toEqual(expect.arrayContaining([recent, boundary, active]));
  });

  it("no borra un evento vencido de otra organización existente, aunque esté inactiva", () => {
    const id = randomUUID();
    const result = sql(`begin; update public.organizations set is_active = false where id = '${ORG_CAFE}';
      ${row(id, "11 years", ORG_CAFE)}
      select private.purge_expired_audit_log(5000);
      select count(*) from public.audit_log where id = '${id}'; rollback;`);
    expect(result.at(-2)).toEqual(["1"]);
  });

  it("con lote amplio aplica realmente el plazo estricto y reactiva la barrera tras el éxito", () => {
    const old = randomUUID(), recent = randomUUID(), boundary = randomUUID();
    const result = sql(`begin; ${row(old, "11 years")} ${row(recent, "1 day")} ${row(boundary, "10 years")}
      select private.purge_expired_audit_log(5000);
      select id from public.audit_log where id in ('${old}', '${recent}', '${boundary}') order by id;
      select tgenabled from pg_trigger where tgname = 'audit_log_no_update_delete'; rollback;`);
    expect(result.flat()).not.toContain(old);
    expect(result.flat()).toEqual(expect.arrayContaining([recent, boundary]));
    expect(result.at(-2)).toEqual(["O"]);
  });

  it("conserva la identidad del local borrado mientras tenga pagos; solo purga cuando desaparece la evidencia contable", () => {
    const org = randomUUID(), id = randomUUID(), payment = randomUUID(), sub = randomUUID();
    const result = sql(`begin; ${row(id, "11 years", org)}
      insert into public.payments (id, created_at, organization_id, subscription_id, plan_code, billing_cycle,
        amount_cents, currency, method, paid_on, previous_period_end, covers_until, registered_by)
      values ('${payment}', now() - interval '12 years', '${org}', '${sub}', 'pro', 'monthly',
        1000, 'ARS', 'cash', current_date, now(), now() + interval '30 days', '${randomUUID()}');
      select private.purge_expired_audit_log(5000);
      select 'kept=' || count(*) from public.audit_log where id = '${id}';
      alter table public.payments disable trigger payments_no_update_delete;
      delete from public.payments where id = '${payment}';
      alter table public.payments enable trigger payments_no_update_delete;
      select private.purge_expired_audit_log(5000);
      select 'removed=' || count(*) from public.audit_log where id = '${id}'; rollback;`);
    expect(result.flat()).toContain("kept=1");
    expect(result.flat()).toContain("removed=0");
  });

  it("rechaza lotes inválidos y mantiene ambas barreras de solo agregado", () => {
    for (const limit of ["0", "5001", "null"]) {
      expect(() => sql(`select private.purge_expired_audit_log(${limit})`)).toThrow(/invalid_limit/);
    }
    expect(sql(`select count(*) from pg_trigger where tgrelid = 'public.audit_log'::regclass
      and tgname in ('audit_log_no_update_delete','audit_log_no_truncate') and tgenabled = 'O'`)[0]).toEqual(["2"]);
    const id = randomUUID();
    expect(() => sql(`begin; ${row(id, "1 day")} delete from public.audit_log where id = '${id}'; rollback;`)).toThrow(/solo agregado/);
  });

  it("una falla posterior revierte el borrado y el estado del trigger", () => {
    const id = randomUUID();
    // El savepoint permite observar el estado después de deshacer la purga sin persistir el fixture.
    expect(sql(`begin; ${row(id, "11 years")}
      savepoint before_purge; select private.purge_expired_audit_log(5000);
      rollback to before_purge;
      select count(*) from public.audit_log where id = '${id}';
      select tgenabled from pg_trigger where tgname = 'audit_log_no_update_delete'; rollback;`).slice(-3, -1)).toEqual([["1"], ["O"]]);
  });

  it("la tarea queda activa con horario diario y lote acotado", () => {
    expect(sql(`select schedule, active, command from cron.job where jobname = 'purge-expired-audit-log'`)[0])
      .toEqual(["30 7 * * *", "t", "select private.purge_expired_audit_log(1000);"]);
  });

  it("un error durante DELETE no deja apagado el trigger ni borra el evento", () => {
    const id = randomUUID();
    const result = sql(`begin; ${row(id, "11 years")}
      create function pg_temp.fail_audit_purge() returns trigger language plpgsql as $$begin raise exception 'synthetic_failure'; end;$$;
      create trigger fail_audit_purge before delete on public.audit_log for each statement execute function pg_temp.fail_audit_purge();
      do $$begin
        perform private.purge_expired_audit_log(5000);
        raise exception 'expected_failure';
      exception when others then if sqlerrm <> 'synthetic_failure' then raise; end if; end;$$;
      select count(*) from public.audit_log where id = '${id}';
      select tgenabled from pg_trigger where tgname = 'audit_log_no_update_delete'; rollback;`);
    expect(result.slice(-3, -1)).toEqual([["1"], ["O"]]);
  });
});
