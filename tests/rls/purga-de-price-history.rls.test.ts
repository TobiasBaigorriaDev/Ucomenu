import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asegurarDestinoLocal, purgeAuditLogWhere } from "./purge-price-history";
import { createCategory, createOrg, deleteOrg, serviceClient, sql, type Db } from "./helpers";

/**
 * Retención y purga de `price_history` (nivel C, ficha purga-de-price-history, ADR 0026) contra el Supabase local.
 * `private.purge_organization_price_history` es la única vía de purga: solo una organización dada de baja (y auditada)
 * hace 30 días o más, solo borra el historial de ESA organización, no deja el trigger de solo-agregado apagado ni
 * aunque falle algo después, y ningún rol de la API la ejecuta. Se llama como `postgres` (psql en el contenedor local):
 * la llamará la función de borrado de organizaciones, que todavía no existe.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const PREFIJO = "tt-purga";

let service: Db;
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; slug: string; productId: string };

/** Una organización con un plato y `cambios` cambios de precio (hechos con service_role: `changed_by` NULL). */
async function crearLocal(cambios = 3): Promise<Local> {
  contador += 1;
  const slug = `${PREFIJO}-${sufijo}-${contador}`;
  const id = await createOrg(service, slug);
  orgs.push(id);
  const categoria = await createCategory(service, id);
  const plato = await service
    .from("products")
    .insert({ organization_id: id, category_id: categoria, name: "tt-plato", price_cents: 1000 })
    .select("id")
    .single();
  if (plato.error) throw new Error(`No se pudo crear el plato: ${plato.error.message}`);
  for (let i = 1; i <= cambios; i++) {
    const r = await service.from("products").update({ price_cents: 1000 + i * 100 }).eq("id", plato.data.id);
    if (r.error) throw new Error(`No se pudo cambiar el precio: ${r.error.message}`);
  }
  return { id, slug, productId: plato.data.id };
}

const historial = (orgId: string) =>
  Number(sql(`select count(*) from public.price_history where organization_id = '${orgId}'`)[0][0]);
const activa = (orgId: string) => sql(`select is_active from public.organizations where id = '${orgId}'`)[0][0] === "t";
const triggerEncendido = () =>
  sql(`select tgenabled from pg_trigger where tgname = 'price_history_no_update_delete'`)[0][0] === "O";

/** Pone la organización de baja a mano, sin pasar por la función (para armar casos que la función nunca produciría). */
const ponerInactiva = (orgId: string) => sql(`update public.organizations set is_active = false where id = '${orgId}'`);

/** Una fila de auditoría con la fecha pedida (el dueño de la tabla puede insertar; ni la API ni service_role). */
function auditar(local: Pick<Local, "id" | "slug">, accion: "organization.deactivated" | "organization.reactivated", hace: string) {
  sql(
    `insert into public.audit_log (created_at, actor_id, actor_email, action, organization_id, after) ` +
      `values (clock_timestamp() - interval '${hace}', '${randomUUID()}', 'tt@example.test', '${accion}', '${local.id}', ` +
      `jsonb_build_object('slug', '${local.slug}', 'reason', 'tt'))`,
  );
}

/** Una baja auditada de hace `hace` y la organización inactiva: lo que deja `admin_set_organization_active`. */
function darDeBaja(local: Pick<Local, "id" | "slug">, hace: string) {
  auditar(local, "organization.deactivated", hace);
  ponerInactiva(local.id);
}

const purgar = (orgId: string) => sql(`select private.purge_organization_price_history('${orgId}')`)[0][0];
const falla = (orgId: string, codigo: string) =>
  expect(() => purgar(orgId)).toThrow(new RegExp(`ERROR:\\s+${codigo}\\b`));

beforeAll(() => {
  service = serviceClient();
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like '${PREFIJO}-%'`);
  for (const id of orgs) await deleteOrg(service, id);
});

describe("quién puede purgar: nadie por la API", () => {
  it("ni anon, ni authenticated, ni service_role, ni public tienen EXECUTE; nadie la ejecuta por la API", () => {
    const [fila] = sql(`
      select has_function_privilege('anon', p.oid, 'execute'),
             has_function_privilege('authenticated', p.oid, 'execute'),
             has_function_privilege('service_role', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'),
             p.prosecdef,
             pg_get_userbyid(p.proowner)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'purge_organization_price_history'`);
    expect(fila).toEqual(["f", "f", "f", "f", "t", "postgres"]);
  });
});

describe("condiciones: baja auditada de 30 días o más", () => {
  it("organización activa: se rechaza y no se borra nada", async () => {
    const local = await crearLocal();
    falla(local.id, "organization_still_active");
    expect(historial(local.id)).toBe(3);
    expect(triggerEncendido()).toBe(true);
  });

  it("organización inexistente: organization_not_found", () => {
    falla(randomUUID(), "organization_not_found");
  });

  it("inactiva puesta a mano, sin baja auditada: deactivation_not_audited", async () => {
    const local = await crearLocal();
    ponerInactiva(local.id);
    falla(local.id, "deactivation_not_audited");
    expect(historial(local.id)).toBe(3);
  });

  it("la baja auditada de OTRA organización no vale", async () => {
    const local = await crearLocal();
    const otra = await crearLocal(1);
    auditar(otra, "organization.deactivated", "90 days");
    ponerInactiva(local.id);
    falla(local.id, "deactivation_not_audited");
    expect(historial(local.id)).toBe(3);
    expect(historial(otra.id)).toBe(1);
  });

  it("baja de menos de 30 días: deactivation_too_recent, también un minuto antes del plazo", async () => {
    const local = await crearLocal();
    darDeBaja(local, "5 days");
    falla(local.id, "deactivation_too_recent");
    expect(historial(local.id)).toBe(3);

    const justo = await crearLocal();
    darDeBaja(justo, "29 days 23 hours 59 minutes");
    falla(justo.id, "deactivation_too_recent");
    expect(historial(justo.id)).toBe(3);
  });

  it("reactivada después de la baja y vuelta a inactivar a mano: el último evento manda (deactivation_not_audited)", async () => {
    const local = await crearLocal();
    auditar(local, "organization.deactivated", "90 days");
    auditar(local, "organization.reactivated", "60 days");
    ponerInactiva(local.id);
    falla(local.id, "deactivation_not_audited");
    expect(historial(local.id)).toBe(3);
  });

  it("reactivada y activa: organization_still_active aunque haya una baja vieja", async () => {
    const local = await crearLocal();
    auditar(local, "organization.deactivated", "90 days");
    auditar(local, "organization.reactivated", "60 days");
    falla(local.id, "organization_still_active");
    expect(historial(local.id)).toBe(3);
  });

  it("dada de baja de nuevo después de una reactivación: cuenta la baja más reciente", async () => {
    const local = await crearLocal();
    auditar(local, "organization.deactivated", "90 days");
    auditar(local, "organization.reactivated", "80 days");
    darDeBaja(local, "10 days");
    falla(local.id, "deactivation_too_recent");
    expect(historial(local.id)).toBe(3);
  });
});

describe("la purga", () => {
  it("con baja de 30 días o más borra solo el historial de esa organización y devuelve cuántas filas", async () => {
    const local = await crearLocal(3);
    const vecina = await crearLocal(2);
    darDeBaja(local, "30 days 1 minute");

    expect(purgar(local.id)).toBe("3");
    expect(historial(local.id)).toBe(0);
    expect(historial(vecina.id)).toBe(2);
  });

  it("no toca la organización, el plato ni la auditoría: solo el historial", async () => {
    const local = await crearLocal(2);
    darDeBaja(local, "45 days");
    const auditoriaAntes = sql(`select count(*) from public.audit_log where organization_id = '${local.id}'`)[0][0];

    purgar(local.id);

    expect(sql(`select count(*) from public.organizations where id = '${local.id}'`)[0][0]).toBe("1");
    expect(sql(`select price_cents from public.products where id = '${local.productId}'`)[0][0]).toBe("1200");
    expect(sql(`select count(*) from public.audit_log where organization_id = '${local.id}'`)[0][0]).toBe(auditoriaAntes);
    expect(activa(local.id)).toBe(false);
  });

  it("deja el trigger de solo-agregado encendido: después de purgar, borrar a mano sigue rechazado", async () => {
    const local = await crearLocal(1);
    darDeBaja(local, "31 days");
    purgar(local.id);
    expect(triggerEncendido()).toBe(true);

    const otra = await crearLocal(1);
    expect(() => sql(`delete from public.price_history where organization_id = '${otra.id}'`)).toThrow(/solo agregado|solo-agregado|42501/i);
    expect(historial(otra.id)).toBe(1);
  });

  it("es idempotente y purga lo que el servicio técnico haya cambiado después", async () => {
    const local = await crearLocal(2);
    darDeBaja(local, "31 days");
    expect(purgar(local.id)).toBe("2");
    expect(purgar(local.id)).toBe("0");

    const r = await service.from("products").update({ price_cents: 5000 }).eq("id", local.productId);
    expect(r.error).toBeNull();
    expect(historial(local.id)).toBe(1);
    expect(purgar(local.id)).toBe("1");
    expect(historial(local.id)).toBe(0);
  });

  it("una organización sin historial devuelve 0", async () => {
    const local = await crearLocal(0);
    darDeBaja(local, "31 days");
    expect(purgar(local.id)).toBe("0");
  });

  it("después de purgar, la organización se puede borrar (ya no la frena RESTRICT del historial)", async () => {
    const local = await crearLocal(2);
    darDeBaja(local, "31 days");
    // Los pagos del SuperAdmin (RESTRICT) son otro ítem; esta organización no tiene.
    expect(sql(`select count(*) from public.payments where organization_id = '${local.id}'`)[0][0]).toBe("0");
    expect(() => sql(`delete from public.organizations where id = '${local.id}'`)).toThrow(/price_history|violates foreign key|23503/);

    purgar(local.id);
    sql(`delete from public.organizations where id = '${local.id}'`);
    expect(sql(`select count(*) from public.organizations where id = '${local.id}'`)[0][0]).toBe("0");
  });
});

describe("falla a mitad: el trigger no queda apagado ni se pierde nada", () => {
  it("si la transacción que llama a la purga falla después, el historial queda y el trigger sigue encendido", async () => {
    const local = await crearLocal(3);
    darDeBaja(local, "31 days");

    expect(() =>
      sql(`begin; select private.purge_organization_price_history('${local.id}'); select 1/0; commit`),
    ).toThrow(/division by zero/);

    expect(historial(local.id)).toBe(3);
    expect(triggerEncendido()).toBe(true);
  });

  it("un ROLLBACK explícito después de purgar también restaura las filas y el trigger", async () => {
    const local = await crearLocal(3);
    darDeBaja(local, "31 days");

    sql(`begin; select private.purge_organization_price_history('${local.id}'); rollback`);

    expect(historial(local.id)).toBe(3);
    expect(triggerEncendido()).toBe(true);
  });

  it("el trigger de TRUNCATE sigue encendido (la purga solo apaga el de UPDATE/DELETE)", () => {
    const [fila] = sql(
      `select count(*) from pg_trigger where tgrelid = 'public.price_history'::regclass and tgname = 'price_history_no_truncate' and tgenabled = 'O'`,
    );
    expect(fila[0]).toBe("1");
  });
});

describe("serialización con la reactivación", () => {
  it("la purga toma el lock de la organización: una reactivación espera a que la transacción termine", async () => {
    const local = await crearLocal(1);
    darDeBaja(local, "31 days");
    // La purga queda dentro de una transacción abierta (dormida) mientras se intenta reactivar con el mismo lock.
    const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
    asegurarDestinoLocal(contenedor);
    const lenta = new Promise<void>((resolve, reject) =>
      execFile(
        "docker",
        [
          "exec",
          contenedor,
          "psql",
          "-U",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-At",
          "-c",
          `begin; select private.purge_organization_price_history('${local.id}'); select pg_sleep(3); commit`,
        ],
        (error) => (error ? reject(error) : resolve()),
      ),
    );
    // Espera a que la sesión esté dormida dentro de la transacción (el lock ya tomado).
    let durmiendo = false;
    for (let intento = 0; intento < 50 && !durmiendo; intento++) {
      durmiendo = sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${local.id}%'`)[0][0] === "1";
      if (!durmiendo) await new Promise((r) => setTimeout(r, 100));
    }
    expect(durmiendo).toBe(true);

    const inicio = Date.now();
    sql(`select 1 from public.organizations where id = '${local.id}' for no key update`);
    const esperado = Date.now() - inicio;
    await lenta;

    expect(esperado).toBeGreaterThan(500); // esperó el lock de la purga
    expect(historial(local.id)).toBe(0);
  }, 30_000);
});
