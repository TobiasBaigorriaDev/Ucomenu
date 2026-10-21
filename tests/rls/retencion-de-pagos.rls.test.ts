import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeAuditLogWhere, purgePaymentsWhere } from "./purge-price-history";
import { createOrg, createUser, deleteOrg, deleteUser, serviceClient, sql, type Db, type TestUser } from "./helpers";

/**
 * Retención y purga de `payments` y `payment_voids` (nivel C, ficha retencion-de-pagos, ADR 0027) contra el Supabase
 * local. Los pagos sobreviven al borrado de la organización (sin clave foránea); `private.purge_expired_payments` borra
 * SOLO los de organizaciones que ya no existen y que se registraron hace más de 10 años, con su auditoría, sin dejar los
 * triggers de solo-agregado apagados y sin que ningún rol de la API la ejecute. Se llama como `postgres` (psql local).
 */

const MARCA = randomUUID(); // `registered_by` de todas las filas de esta corrida: sirve para limpiarlas
const MOTIVO = "tt-retencion";

let service: Db;
let admin: TestUser;
let comun: TestUser;
let orgViva: string;
let subViva: string;
const orgs: string[] = [];

const contar = (donde: string) => Number(sql(`select count(*) from public.payments where registered_by = '${MARCA}' and ${donde}`)[0][0]);
const contarAnulaciones = (donde: string) =>
  Number(sql(`select count(*) from public.payment_voids where voided_by = '${MARCA}' and ${donde}`)[0][0]);
const triggersEncendidos = () =>
  sql(
    `select count(*) from pg_trigger where tgname in ('payments_no_update_delete', 'payment_voids_no_update_delete') and tgenabled = 'O'`,
  )[0][0] === "2";
const auditorias = () =>
  Number(sql(`select count(*) from public.audit_log where action = 'payments.purged' and after->>'reason' like '${MOTIVO}%'`)[0][0]);

/** Un pago registrado `hace` atrás. El dueño de la tabla puede insertar; ni la API ni service_role. */
function pago(orgId: string, subId: string, hace: string): string {
  const id = randomUUID();
  sql(
    `insert into public.payments (id, created_at, organization_id, subscription_id, plan_code, billing_cycle, amount_cents, currency, method, ` +
      `paid_on, previous_period_end, covers_until, registered_by) values ('${id}', clock_timestamp() - interval '${hace}', '${orgId}', '${subId}', ` +
      `'pro', 'monthly', 1000, 'ARS', 'cash', current_date, now(), now() + interval '30 days', '${MARCA}')`,
  );
  return id;
}

function anulacion(paymentId: string, orgId: string, subId: string, hace: string) {
  sql(
    `insert into public.payment_voids (created_at, payment_id, organization_id, subscription_id, reason, voided_by, period_end_before, period_end_after) ` +
      `values (clock_timestamp() - interval '${hace}', '${paymentId}', '${orgId}', '${subId}', 'tt', '${MARCA}', now(), now())`,
  );
}

const purgar = (actor: string, motivo = `${MOTIVO}-x`) =>
  sql(`select * from private.purge_expired_payments('${actor}', '${motivo.replaceAll("'", "''")}')`)[0];
const falla = (actor: string, motivo: string, codigo: string) =>
  expect(() => purgar(actor, motivo)).toThrow(new RegExp(`ERROR:\\s+${codigo}\\b`));

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "ret-admin");
  comun = await createUser(service, "ret-comun");
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
  orgViva = await createOrg(service, `tt-ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, "pro");
  orgs.push(orgViva);
  subViva = sql(`select id from public.subscriptions where organization_id = '${orgViva}'`)[0][0];
});

afterAll(async () => {
  purgeAuditLogWhere(`action = 'payments.purged' and after->>'reason' like '${MOTIVO}%'`);
  purgePaymentsWhere(`registered_by = '${MARCA}'`);
  for (const id of orgs) await deleteOrg(service, id);
  await deleteUser(service, admin);
  await deleteUser(service, comun);
});

describe("los pagos sobreviven al borrado de la organización", () => {
  it("payments y payment_voids no tienen clave foránea hacia organizaciones ni suscripciones; la anulación sigue atada a su pago", () => {
    const filas = sql(
      `select conrelid::regclass::text, confrelid::regclass::text from pg_constraint ` +
        `where contype = 'f' and conrelid in ('public.payments'::regclass, 'public.payment_voids'::regclass) order by 1, 2`,
    );
    expect(filas).toEqual([["payment_voids", "payments"]]);
  });
});

describe("quién puede purgar: nadie por la API", () => {
  it("ni anon, ni authenticated, ni service_role, ni public tienen EXECUTE; SECURITY DEFINER de postgres", () => {
    const [fila] = sql(`
      select has_function_privilege('anon', p.oid, 'execute'),
             has_function_privilege('authenticated', p.oid, 'execute'),
             has_function_privilege('service_role', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'),
             p.prosecdef,
             pg_get_userbyid(p.proowner)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'purge_expired_payments'`);
    expect(fila).toEqual(["f", "f", "f", "f", "t", "postgres"]);
  });

  it("quien llama tiene que ser SuperAdmin y dar un motivo: si no, se rechaza y no se borra nada", () => {
    const huerfana = randomUUID();
    const vieja = pago(huerfana, randomUUID(), "11 years");
    for (const actor of [comun.id, randomUUID()]) falla(actor, MOTIVO, "not_platform_admin");
    expect(() => sql(`select * from private.purge_expired_payments(null, '${MOTIVO}')`)).toThrow(/not_platform_admin/);
    falla(admin.id, "", "invalid_reason");
    falla(admin.id, "   ", "invalid_reason");
    falla(admin.id, `${MOTIVO}${"x".repeat(200)}`, "invalid_reason");
    expect(sql(`select count(*) from public.payments where id = '${vieja}'`)[0][0]).toBe("1");
    expect(triggersEncendidos()).toBe(true);
    purgePaymentsWhere(`id = '${vieja}'`); // que no la cuente la prueba siguiente (la purga es global)
  });
});

describe("la purga", () => {
  it("borra solo los pagos de organizaciones borradas con más de 10 años, con sus anulaciones, y deja auditoría", () => {
    const orfana = randomUUID();
    const sub = randomUUID();

    const a = pago(orfana, sub, "11 years"); // se va, con su anulación
    anulacion(a, orfana, sub, "10 years 6 months");
    const b = pago(orfana, sub, "12 years"); // se va
    const f = pago(orfana, sub, "10 years 1 day"); // se va (pasó el plazo)
    const c = pago(orfana, sub, "9 years"); // queda (reciente)
    const g = pago(orfana, sub, "9 years 364 days"); // queda (un día antes del plazo)
    const d = pago(orgViva, subViva, "11 years"); // queda: la organización existe, por vieja que sea
    anulacion(d, orgViva, subViva, "5 years"); // y su anulación también

    const auditoriasAntes = auditorias();
    const [pagos, anulaciones] = purgar(admin.id, `${MOTIVO}-borra`);
    expect([pagos, anulaciones]).toEqual(["3", "1"]);

    expect(contar(`id in ('${a}', '${b}', '${f}')`)).toBe(0);
    expect(contar(`id in ('${c}', '${g}', '${d}')`)).toBe(3);
    expect(contarAnulaciones(`payment_id = '${a}'`)).toBe(0);
    expect(contarAnulaciones(`payment_id = '${d}'`)).toBe(1);

    expect(auditorias()).toBe(auditoriasAntes + 1);
    const [fila] = sql(
      `select actor_id, organization_id is null, after->>'payments', after->>'voids', after->>'years' from public.audit_log ` +
        `where action = 'payments.purged' and after->>'reason' = '${MOTIVO}-borra'`,
    );
    expect(fila).toEqual([admin.id, "t", "3", "1", "10"]);
    expect(triggersEncendidos()).toBe(true);
  });

  it("es idempotente: sin nada que purgar devuelve 0 y no deja auditoría", () => {
    const antes = auditorias();
    expect(purgar(admin.id, `${MOTIVO}-vacio`)).toEqual(["0", "0"]);
    expect(auditorias()).toBe(antes);
  });

  it("deja los triggers de solo-agregado encendidos: borrar o modificar a mano sigue rechazado", () => {
    const viva = pago(orgViva, subViva, "1 day");
    purgar(admin.id, `${MOTIVO}-triggers`);
    expect(triggersEncendidos()).toBe(true);
    expect(() => sql(`delete from public.payments where id = '${viva}'`)).toThrow(/solo agregado|solo-agregado|42501/i);
    expect(() => sql(`update public.payments set amount_cents = 1 where id = '${viva}'`)).toThrow(/solo agregado|solo-agregado|42501/i);
    expect(contar(`id = '${viva}'`)).toBe(1);
  });
});

describe("falla a mitad: los triggers no quedan apagados ni se pierde nada", () => {
  it("si la transacción que llama a la purga falla después, los pagos y las anulaciones quedan y los triggers siguen encendidos", () => {
    const orfana = randomUUID();
    const sub = randomUUID();
    const vieja = pago(orfana, sub, "11 years");
    anulacion(vieja, orfana, sub, "10 years 6 months");

    expect(() =>
      sql(`begin; select * from private.purge_expired_payments('${admin.id}', '${MOTIVO}-rollback'); select 1/0; commit`),
    ).toThrow(/division by zero/);

    expect(contar(`id = '${vieja}'`)).toBe(1);
    expect(contarAnulaciones(`payment_id = '${vieja}'`)).toBe(1);
    expect(triggersEncendidos()).toBe(true);
    expect(auditorias()).toBe(Number(sql(`select count(*) from public.audit_log where action = 'payments.purged' and after->>'reason' like '${MOTIVO}%'`)[0][0]));
    expect(sql(`select count(*) from public.audit_log where after->>'reason' = '${MOTIVO}-rollback'`)[0][0]).toBe("0");

    purgar(admin.id, `${MOTIVO}-limpia`); // la deja ir
    expect(contar(`id = '${vieja}'`)).toBe(0);
  });
});
