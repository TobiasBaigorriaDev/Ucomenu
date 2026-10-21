import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asegurarDestinoLocal, purgeAuditLogWhere } from "./purge-price-history";
import { createOrg, deleteOrg, serviceClient, sql, type Db } from "./helpers";

/**
 * Retiro del add-on `webar` (migración 20261110100000, nivel C, ficha catalogo-video-feed). La migración ya corrió en la
 * base de pruebas, así que se REEJECUTA su bloque de retiro (entre las marcas `[retiro-webar:…]`) sobre datos sembrados.
 * Foco: que cada contrato vigente deje su `addon.ended` aunque lo reactive otra sesión mientras la migración espera.
 */

const execFileAsync = promisify(execFile);
const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function bloqueDeRetiro(): string {
  const archivo = readFileSync(new URL("../../supabase/migrations/20261110100000_catalogo_video_feed.sql", import.meta.url), "utf8");
  const ini = archivo.indexOf("-- [retiro-webar:inicio]");
  const fin = archivo.indexOf("-- [retiro-webar:fin]");
  expect(ini).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(ini);
  return archivo.slice(ini, fin);
}

const psql = (consulta: string) =>
  execFileAsync("docker", ["exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", consulta], { encoding: "utf8" });

let service: Db;
const orgs: string[] = [];

beforeAll(() => {
  asegurarDestinoLocal(contenedor);
  service = serviceClient();
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-retiro-%'`);
  for (const id of orgs) await deleteOrg(service, id);
  sql(`delete from public.addons where code = 'webar'`);
});

function sembrar() {
  sql(`insert into public.addons (code, name, monthly_price_usd_cents, base_model_quota, pack_size, pack_monthly_price_usd_cents, allowed_plans)
       values ('webar', 'WebAR', 2500, 15, 10, 1000, array['pro', 'premium']) on conflict (code) do nothing`);
}

async function crearLocal(etiqueta: string) {
  const id = await createOrg(service, `tt-retiro-${sufijo}-${etiqueta}`, "pro");
  orgs.push(id);
  return id;
}

const contratos = (orgId: string) => sql(`select extra_packs, ends_at is null from public.subscription_addons where organization_id = '${orgId}'`);
const retiros = (orgId: string) =>
  sql(`select actor_email, before->>'extra_packs', after->>'reason' from public.audit_log where organization_id = '${orgId}' and action = 'addon.ended'`);

describe("retiro de WebAR: reejecución del bloque de la migración", () => {
  it("cierra con auditoría solo los contratos vigentes y borra todos, más la fila del catálogo", async () => {
    sembrar();
    const vigente = await crearLocal("vigente");
    const futuro = await crearLocal("futuro");
    const vencido = await crearLocal("vencido");
    sql(`insert into public.subscription_addons (organization_id, addon_code, extra_packs, ends_at) values
         ('${vigente}', 'webar', 2, null),
         ('${futuro}', 'webar', 1, now() + interval '30 days'),
         ('${vencido}', 'webar', 3, now() - interval '1 day')`);

    await psql(bloqueDeRetiro());

    for (const id of [vigente, futuro, vencido]) expect(contratos(id)).toEqual([]);
    expect(sql(`select count(*) from public.addons where code = 'webar'`)[0][0]).toBe("0");
    for (const [id, packs] of [[vigente, "2"], [futuro, "1"]] as const) {
      expect(retiros(id)).toEqual([["sistema (migración 20261110100000)", packs, "Add-on retirado del catálogo (ADR 0031)"]]);
    }
    expect(retiros(vencido)).toEqual([]); // ya estaba finalizado: no hay nada que cerrar
  });

  it("un contrato reactivado mientras la migración espera NO se pierde sin su cierre", async () => {
    sembrar();
    const id = await crearLocal("carrera");
    sql(`insert into public.subscription_addons (organization_id, addon_code, extra_packs, ends_at)
         values ('${id}', 'webar', 4, now() - interval '1 hour')`);

    // Sesión A (lo que haría admin_set_addon al reactivarlo): toma la fila, duerme y recién entonces confirma.
    const marca = `reactiva-${sufijo}`;
    const reactivacion = psql(
      `begin; select '${marca}'; select 1 from public.subscription_addons where organization_id = '${id}' for update;
       update public.subscription_addons set ends_at = null where organization_id = '${id}'; select pg_sleep(3); commit;`,
    );
    // Sincronización explícita: no sigue hasta ver a la sesión A DENTRO de pg_sleep (con el cambio sin confirmar).
    let durmiendo = false;
    for (let intento = 0; intento < 50 && !durmiendo; intento++) {
      durmiendo = sql(`select count(*) from pg_stat_activity where pid <> pg_backend_pid() and wait_event = 'PgSleep' and query like '%${marca}%'`)[0][0] === "1";
      if (!durmiendo) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!durmiendo) throw new Error("la sesión que reactiva no llegó a dormir: la prueba no sería válida");

    await psql(bloqueDeRetiro()); // espera el bloqueo hasta que A confirma
    await reactivacion;

    expect(contratos(id)).toEqual([]);
    expect(retiros(id)).toEqual([["sistema (migración 20261110100000)", "4", "Add-on retirado del catálogo (ADR 0031)"]]);
  }, 30_000);

  it("una función de add-ons que ya tomó la fila (for update) y aún no escribió no provoca un interbloqueo", async () => {
    sembrar();
    const id = await crearLocal("interbloqueo");
    sql(`insert into public.subscription_addons (organization_id, addon_code, extra_packs, ends_at)
         values ('${id}', 'webar', 5, now() - interval '1 hour')`);

    // Sesión A: como admin_set_addon, toma la fila con `for update`, tarda y recién después escribe.
    const marca = `fila-${sufijo}`;
    const reactivacion = psql(
      `begin; select '${marca}'; select 1 from public.subscription_addons where organization_id = '${id}' for update;
       select pg_sleep(3); update public.subscription_addons set ends_at = null where organization_id = '${id}'; commit;`,
    );
    let durmiendo = false;
    for (let intento = 0; intento < 50 && !durmiendo; intento++) {
      durmiendo = sql(`select count(*) from pg_stat_activity where pid <> pg_backend_pid() and wait_event = 'PgSleep' and query like '%${marca}%'`)[0][0] === "1";
      if (!durmiendo) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!durmiendo) throw new Error("la sesión que reactiva no llegó a dormir: la prueba no sería válida");

    // Ninguna de las dos debe abortar (con un bloqueo más débil, PostgreSQL detecta el ciclo y aborta una).
    const resultados = await Promise.allSettled([psql(bloqueDeRetiro()), reactivacion]);
    expect(resultados.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    expect(contratos(id)).toEqual([]);
    expect(retiros(id)).toEqual([["sistema (migración 20261110100000)", "5", "Add-on retirado del catálogo (ADR 0031)"]]);
  }, 30_000);
});
