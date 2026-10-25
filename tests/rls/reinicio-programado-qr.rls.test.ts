import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, serviceClient, sql, type Db, type TestUser } from "./helpers";

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([createUser(service, "qr-owner"), createUser(service, "qr-staff"), createUser(service, "qr-stranger")]);
});
afterEach(async () => { for (const id of orgs.splice(0)) await deleteOrg(service, id); });
afterAll(async () => { for (const user of [owner, staff, stranger]) await deleteUser(service, user); });

async function fixture() {
  const org = await createOrg(service, `tt-reset-${randomUUID().slice(0, 8)}`, "pro");
  orgs.push(org);
  await addMembership(service, owner, org, "owner");
  await addMembership(service, staff, org, "staff");
  const { data: branches, error } = await service.from("branches").insert([
    { organization_id: org, name: "Centro", slug: "centro" },
    { organization_id: org, name: "Norte", slug: "norte" },
  ]).select("id, slug, qr_reset_times").order("slug");
  if (error) throw error;
  const { data: tables, error: tableError } = await service.from("tables").insert(branches!.flatMap((branch) => ["1", "2"].map((label) => ({ organization_id: org, branch_id: branch.id, label })))).select("id, branch_id, qr_token, turn_started_at").order("id");
  if (tableError) throw tableError;
  return { org, branches: branches!, tables: tables! };
}
const turns = async (org: string) => (await service.from("tables").select("id, qr_token, turn_started_at").eq("organization_id", org).order("id")).data!;
function schedule(branch: string, times = "array['05:00'::time]") {
  sql(`update public.branches set qr_reset_times = ${times}, timezone = 'America/Argentina/Buenos_Aires' where id='${branch}';
    update public.branches set qr_reset_after='2020-06-30T00:00:00Z' where id='${branch}'`);
}
const run = (at: string) => Number(sql(`select private.run_scheduled_table_resets('${at}'::timestamptz)`)[0][0]);

describe("reinicio de QR programado y masivo", () => {
  it("las nuevas sucursales tienen 05:00 por defecto y no recuperan horarios previos al alta", async () => {
    const f = await fixture();
    expect(f.branches.every((b) => b.qr_reset_times.join() === "05:00:00")).toBe(true);
    const before = await turns(f.org);
    expect(run("2020-07-01T08:00:00Z")).toBe(0);
    expect(await turns(f.org)).toEqual(before);
  });
  it("solo Dueño configura y la base rechaza duplicados, segundos, nulos o más de 24 horarios", async () => {
    const f = await fixture();
    const id = f.branches[0].id;
    for (const db of [staff.db, stranger.db, anonClient()]) {
      const result = await db.from("branches").update({ qr_reset_times: ["07:00"] }).eq("id", id).select("id");
      expect(result.data?.length ?? 0).toBe(0);
    }
    expect((await owner.db.from("branches").update({ qr_reset_times: ["05:00", "17:30"] }).eq("id", id).select("id")).data).toHaveLength(1);
    for (const bad of [["05:00", "05:00"], ["05:00:01"], ["24:00"], [null], Array(25).fill("05:00")]) {
      expect((await owner.db.from("branches").update({ qr_reset_times: bad as string[] }).eq("id", id)).error?.code).toBe("23514");
    }
    expect((await owner.db.from("branches").update({ qr_reset_times: [] }).eq("id", id)).error).toBeNull();
  });
  it("el marcador no es editable por personas y cambiar zona u horarios no ejecuta el pasado", async () => {
    const f = await fixture();
    const id = f.branches[0].id;
    expect((await owner.db.from("branches").update({ qr_reset_after: "2000-01-01" }).eq("id", id)).error?.code).toBe("42501");
    schedule(id);
    expect((await owner.db.from("branches").update({ qr_reset_times: ["06:00"] }).eq("id", id)).error).toBeNull();
    expect(run("2020-07-01T09:00:00Z")).toBe(0);
    schedule(id);
    expect((await owner.db.from("branches").update({ timezone: "America/Santiago" }).eq("id", id)).error).toBeNull();
    expect(run("2020-07-01T09:00:00Z")).toBe(0);
  });
  it("05:00 local, varios horarios y reintentos: rota solo la sucursal que corresponde", async () => {
    const f = await fixture();
    schedule(f.branches[0].id, "array['05:00'::time,'17:00'::time]");
    // Solo el día de ensayo: no hay un horario pendiente del día anterior.
    sql(`update public.branches set qr_reset_after='2020-07-01T00:00:00Z' where id='${f.branches[0].id}'`);
    const before = await turns(f.org);
    expect(run("2020-07-01T07:59:59Z")).toBe(0);
    expect(run("2020-07-01T08:00:00Z")).toBe(2);
    const first = await turns(f.org);
    for (const table of f.tables) {
      const a = before.find((t) => t.id === table.id)!;
      const b = first.find((t) => t.id === table.id)!;
      expect(b.qr_token).toBe(a.qr_token);
      expect(b.turn_started_at === a.turn_started_at).toBe(table.branch_id !== f.branches[0].id);
    }
    expect(run("2020-07-01T08:01:00Z")).toBe(0);
    expect(await turns(f.org)).toEqual(first);
    expect(run("2020-07-01T20:00:00Z")).toBe(2);
  });
  it("recupera solo el último horario pendiente y permite desactivar", async () => {
    const f = await fixture();
    schedule(f.branches[0].id, "array['05:00'::time,'17:00'::time]");
    expect(run("2020-07-05T21:00:00Z")).toBe(2);
    expect(run("2020-07-05T21:01:00Z")).toBe(0);
    await owner.db.from("branches").update({ qr_reset_times: [] }).eq("id", f.branches[0].id);
    expect(run("2020-07-06T21:00:00Z")).toBe(0);
    // La sucursal sin horarios no cambia, aunque haya pasado el horario de otro día.
    const before = await turns(f.org);
    run("2020-07-06T21:01:00Z");
    expect(await turns(f.org)).toEqual(before);
  });
  it("el ejecutor no se puede invocar desde la API; el job existe cada minuto y está aislado durante las pruebas", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(sql(`select has_function_privilege('${role}', 'private.run_scheduled_table_resets(timestamptz)', 'execute')`)[0][0]).toBe("f");
    }
    expect(sql("select schedule, active::text, username from cron.job where jobname='reset-scheduled-table-turns'")).toEqual([["* * * * *", "false", "postgres"]]);
  });
  it("los horarios se leen solo por RPC del Dueño y reactivar no recupera horarios de una sucursal apagada", async () => {
    const f = await fixture();
    for (const db of [anonClient(), owner.db, staff.db, stranger.db]) {
      expect((await db.from("branches").select("qr_reset_times, qr_reset_after").eq("id", f.branches[0].id)).error?.code).toBe("42501");
    }
    expect((await owner.db.rpc("owner_qr_reset_schedules", { p_org: f.org })).data).toHaveLength(2);
    for (const db of [staff.db, stranger.db]) expect((await db.rpc("owner_qr_reset_schedules", { p_org: f.org })).data).toEqual([]);
    expect((await anonClient().rpc("owner_qr_reset_schedules", { p_org: f.org })).error?.code).toBe("42501");
    const id = f.branches[0].id;
    await owner.db.from("branches").update({ is_active: false }).eq("id", id);
    schedule(id);
    expect((await owner.db.from("branches").update({ is_active: true }).eq("id", id)).error).toBeNull();
    expect(run("2020-07-01T08:00:00Z")).toBe(0);
  });
  it("Staff reinicia todo su local, incluidas sucursales inactivas; no cambia QR ni toca otro local", async () => {
    const a = await fixture();
    const b = await fixture();
    await service.from("branches").update({ is_active: false }).eq("id", a.branches[1].id);
    const beforeA = await turns(a.org);
    const beforeB = await turns(b.org);
    const result = await staff.db.rpc("reset_all_table_turns", { p_org: a.org });
    expect(result.error).toBeNull();
    expect(result.data).toBe(4);
    const after = await turns(a.org);
    expect(after.every((t, i) => t.qr_token === beforeA[i].qr_token && t.turn_started_at > beforeA[i].turn_started_at)).toBe(true);
    expect(await turns(b.org)).toEqual(beforeB);
  });
  it("ajeno y anónimo no reinician; service_role no tiene EXECUTE", async () => {
    const f = await fixture();
    const before = await turns(f.org);
    for (const db of [stranger.db, anonClient(), service]) expect((await db.rpc("reset_all_table_turns", { p_org: f.org })).error).not.toBeNull();
    expect(await turns(f.org)).toEqual(before);
  });
  it("el reinicio programado y el manual vencen la cuenta pendiente, conservan pedidos y permiten el reinicio sin plan", async () => {
    const f = await fixture();
    const table = f.tables[0];
    sql(`insert into public.orders (organization_id,branch_id,table_id,table_label,opened_by)
      values ('${f.org}','${table.branch_id}','${table.id}','Mesa','${owner.id}')`);
    const beforeOrder = sql(`select row_to_json(o)::text from public.orders o where organization_id='${f.org}'`);
    expect((await service.rpc("create_waiter_call", { p_token: table.qr_token, p_kind: "waiter" })).error).toBeNull();
    for (const mode of ["scheduled", "manual"]) {
      const result = await service.rpc("create_waiter_call", { p_token: table.qr_token, p_kind: "bill" });
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({ status: "created" });
      if (mode === "scheduled") {
        schedule(table.branch_id);
        expect(run("2020-07-01T08:00:00Z")).toBe(2);
      } else {
        // No depender de plan ni vigencia, como el reinicio individual.
        await service.from("subscriptions").update({ plan_code: "basic", current_period_end: "2020-01-01", trial_ends_at: null }).eq("organization_id", f.org);
        expect((await owner.db.rpc("reset_all_table_turns", { p_org: f.org })).error).toBeNull();
      }
      expect(sql(`select status from public.waiter_calls where table_id='${table.id}' and kind='bill' and status='pending'`)).toEqual([]);
      expect(sql(`select status from public.waiter_calls where table_id='${table.id}' and kind='waiter'`)).toEqual([["pending"]]);
      expect(sql(`select row_to_json(o)::text from public.orders o where organization_id='${f.org}'`)).toEqual(beforeOrder);
      // Evita el cooldown al preparar la siguiente fase: solo datos ficticios locales.
      sql(`update public.waiter_calls set created_at=now()-interval '1 hour' where table_id='${table.id}' and kind='bill'`);
    }
  });
  it("hora repetida por cambio estacional: ejecuta una sola vez", async () => {
    const f = await fixture();
    schedule(f.branches[0].id, "array['01:30'::time]");
    sql(`update public.branches set timezone='America/New_York' where id='${f.branches[0].id}';
      update public.branches set qr_reset_after='2020-11-01T04:00:00Z' where id='${f.branches[0].id}'`);
    expect(run("2020-11-01T05:30:00Z")).toBe(0);
    expect(run("2020-11-01T06:30:00Z")).toBe(2);
    const before = await turns(f.org);
    expect(run("2020-11-01T06:31:00Z")).toBe(0);
    expect(await turns(f.org)).toEqual(before);
  });
  it("revocar al Staff mientras espera una mesa revierte el reinicio completo", async () => {
    const f = await fixture();
    const before = await turns(f.org);
    const marker = `qr-revoke-${f.org}`;
    const lock = spawn("docker", ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c",
      `begin; select 1 from public.tables where id='${f.tables[0].id}' for no key update; select pg_sleep(30) /* ${marker} */; rollback;`], { stdio: "ignore" });
    const finished = new Promise((resolve) => lock.on("exit", resolve));
    const until = async (check: () => boolean) => {
      const end = Date.now() + 12_000;
      while (Date.now() < end) { if (check()) return true; await new Promise((r) => setTimeout(r, 100)); }
      return false;
    };
    try {
      expect(await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%${marker}%'`)[0][0]) > 0)).toBe(true);
      const pending = staff.db.rpc("reset_all_table_turns", { p_org: f.org }).then((r) => r);
      expect(await until(() => Number(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%reset_all_table_turns%'")[0][0]) > 0)).toBe(true);
      expect((await service.from("memberships").delete().eq("organization_id", f.org).eq("user_id", staff.id)).error).toBeNull();
      sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event='PgSleep' and query like '%${marker}%'`);
      expect((await pending).error).not.toBeNull();
      expect(await turns(f.org)).toEqual(before);
    } finally {
      sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event='PgSleep' and query like '%${marker}%'`);
      await finished;
    }
  });
  it("un llamado en curso no se interbloquea con ninguno de los reinicios y su cuenta pendiente vence", async () => {
    for (const mode of ["scheduled", "manual"]) {
      const f = await fixture();
      const table = f.tables[0];
      schedule(table.branch_id);
      const marker = `qr-call-${table.id}`;
      const call = spawn("docker", ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
        `begin; select pg_advisory_xact_lock(hashtextextended('waiter_call:${table.id}',0)); select pg_sleep(5) /* ${marker} */;
        select public.create_waiter_call('${table.qr_token}','bill'); commit;`], { stdio: "ignore" });
      const finished = new Promise((resolve) => call.on("exit", resolve));
      const end = Date.now() + 12_000;
      while (Date.now() < end && sql(`select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%${marker}%'`)[0][0] === "0") {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(sql(`select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%${marker}%'`)[0][0]).toBe("1");
      if (mode === "scheduled") expect(run("2020-07-01T08:00:00Z")).toBe(2);
      else expect((await staff.db.rpc("reset_all_table_turns", { p_org: f.org })).error).toBeNull();
      expect(await finished).toBe(0);
      expect(sql(`select status from public.waiter_calls where table_id='${table.id}' and kind='bill'`)).toEqual([["expired"]]);
    }
  });
});
