import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteOrganization } from "@/lib/admin/delete-organization";
import type { AdminContext } from "@/lib/admin/organizations";
import { getOrganizationDetail, registerPayment, setOrganizationActive, voidPayment } from "@/lib/admin/subscriptions";
import { asegurarDestinoLocal, purgeAuditLogWhere, purgePaymentsWhere } from "./purge-price-history";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  DIA_MS,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * SuperAdmin: borrado definitivo de organizaciones (nivel C, ficha borrado-de-organizaciones, ADR 0028) contra el Supabase
 * local, con los mismos clientes que usa el servidor. El foco: quién puede, que cada rechazo no deje huella, que el borrado
 * sea atómico (organización, historial de precios y auditoría juntos), que se conserven los pagos y las cuentas, que se
 * limpien los archivos de Storage de ESA organización y que dos pedidos a la vez no dupliquen nada.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const PREFIJO = "tt-borrado";
const hoyAr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const enDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString().slice(0, 10);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let service: Db;
let admin: TestUser;
let comun: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
const archivos: Array<{ bucket: string; path: string }> = [];
let contador = 0;

const execFileAsync = promisify(execFile);

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser; productId: string; fotos: string[]; logo: string };

/** Una organización con Dueño, Staff, sucursal, carta con historial de precios y un logo y una foto en Storage. */
async function crearLocal(cambios = 3): Promise<Local> {
  contador += 1;
  const slug = `${PREFIJO}-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const branch = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" });
  if (branch.error) throw new Error(`No se pudo crear la sucursal: ${branch.error.message}`);
  const owner = await createUser(service, `borrado-d${contador}`);
  const staff = await createUser(service, `borrado-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
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
  const foto = `${id}/${plato.data.id}/${randomUUID()}.png`;
  const logo = `${id}/${randomUUID()}.png`;
  await subir("product-images", foto);
  await subir("organization-logos", logo);
  return { id, slug, owner, staff, productId: plato.data.id, fotos: [foto], logo };
}

async function subir(bucket: string, path: string) {
  const r = await service.storage.from(bucket).upload(path, PNG, { contentType: "image/png", upsert: false });
  if (r.error) throw new Error(`No se pudo subir ${bucket}/${path}: ${r.error.message}`);
  archivos.push({ bucket, path });
}

async function existeArchivo(bucket: string, path: string): Promise<boolean> {
  const carpeta = path.split("/").slice(0, -1).join("/");
  const nombre = path.split("/").at(-1)!;
  const r = await service.storage.from(bucket).list(carpeta, { search: nombre });
  if (r.error) throw new Error(r.error.message);
  return r.data.some((f) => f.name === nombre);
}

const cuenta = (tabla: string, orgId: string, columna = "organization_id") =>
  Number(sql(`select count(*) from public.${tabla} where ${columna} = '${orgId}'`)[0][0]);
const existe = (orgId: string) => cuenta("organizations", orgId, "id") === 1;
const activa = (orgId: string) => sql(`select is_active from public.organizations where id = '${orgId}'`)[0][0] === "t";
const historial = (orgId: string) => cuenta("price_history", orgId);
const auditoria = async (orgId: string) =>
  (await service.from("audit_log").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;
const borrados = async (orgId: string) => (await auditoria(orgId)).filter((a) => a.action === "organization.deleted");
const triggerEncendido = (nombre: string) => sql(`select tgenabled from pg_trigger where tgname = '${nombre}'`)[0][0] === "O";
const triggersEncendidos = () =>
  [
    "price_history_no_update_delete",
    "payments_no_update_delete",
    "payment_voids_no_update_delete",
    "audit_log_no_update_delete",
    "promotion_history_no_update_delete",
    "order_events_no_update_delete",
  ].every(triggerEncendido);

const baja = (local: Pick<Local, "slug">, active: boolean, quien: TestUser = admin) =>
  setOrganizationActive(ctx(quien), { slug: local.slug, active, reason: "Cierra el local" });

/** Una promoción con su plato y un cambio: deja 3 constancias en `promotion_history` (alta, plato, cambio). */
async function conPromociones(local: Pick<Local, "id" | "productId">) {
  const promo = await service
    .from("promotions")
    .insert({ organization_id: local.id, name: "Mitad", discount_type: "percent", discount_value: 50, weekdays_mask: 127, start_minute: 0, end_minute: 1440 })
    .select("id")
    .single();
  if (promo.error) throw new Error(`promoción: ${promo.error.message}`);
  const objetivo = await service.from("promotion_targets").insert({ organization_id: local.id, promotion_id: promo.data.id, product_id: local.productId });
  if (objetivo.error) throw new Error(`objetivo: ${objetivo.error.message}`);
  const cambio = await service.from("promotions").update({ discount_value: 40 }).eq("id", promo.data.id);
  if (cambio.error) throw new Error(`cambio: ${cambio.error.message}`);
  expect(cuenta("promotion_history", local.id)).toBe(3);
}

/** Hace que la baja auditada tenga la antigüedad pedida (la auditoría solo se agrega: se apaga su trigger un momento, como hace la limpieza de pruebas). */
function envejecerBaja(orgId: string, hace: string) {
  sql(
    `begin; alter table public.audit_log disable trigger audit_log_no_update_delete; ` +
      `update public.audit_log set created_at = clock_timestamp() - interval '${hace}' where organization_id = '${orgId}' and action = 'organization.deactivated'; ` +
      `alter table public.audit_log enable trigger audit_log_no_update_delete; commit`,
  );
}

/** Dada de baja de verdad (por la acción) y con la baja de hace `hace`. */
async function darDeBaja(local: Pick<Local, "id" | "slug">, hace = "31 days") {
  expect(await baja(local, false)).toEqual({ ok: true, data: undefined });
  envejecerBaja(local.id, hace);
}

const borrar = (local: Pick<Local, "slug">, cambios: Partial<Parameters<typeof deleteOrganization>[1]> = {}, quien: TestUser = admin) =>
  deleteOrganization(ctx(quien), { slug: local.slug, confirmSlug: local.slug, reason: "Cerró hace meses", ...cambios });

/** Llamada directa a la función de base (service_role), sin la validación previa del módulo. */
const directa = (orgId: string, slug: string, reason: string | null, actor: string | null = admin.id) =>
  service.rpc("admin_delete_organization", { p_actor: actor as string, p_org: orgId, p_slug: slug, p_reason: reason as string });

/** Un pago y una anulación de la organización (el SuperAdmin de la prueba), para comprobar que se conservan. */
async function conPagos(local: Pick<Local, "slug">) {
  const pago = await registerPayment(ctx(admin), {
    slug: local.slug,
    amount: "20000",
    currency: "ARS",
    method: "cash",
    reference: "",
    paidOn: hoyAr(),
    coversUntil: enDias(60),
  });
  if (!pago.ok) throw new Error(`No se pudo registrar el pago: ${pago.error}`);
  const anulado = await voidPayment(ctx(admin), { slug: local.slug, paymentId: pago.data.paymentId, reason: "Mal cargado" });
  if (!anulado.ok) throw new Error(`No se pudo anular el pago: ${anulado.error}`);
  const otro = await registerPayment(ctx(admin), {
    slug: local.slug,
    amount: "25000",
    currency: "ARS",
    method: "transfer",
    reference: "op-1",
    paidOn: hoyAr(),
    coversUntil: enDias(61),
  });
  if (!otro.ok) throw new Error(`No se pudo registrar el pago: ${otro.error}`);
  return { pagos: [pago.data.paymentId, otro.data.paymentId], anulacion: anulado.data.voidId };
}

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "borrado-admin");
  comun = await createUser(service, "borrado-comun");
  users.push(admin, comun);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
});

afterAll(async () => {
  // Pagos huérfanos de las organizaciones borradas (se conservan a propósito: ADR 0027) y archivos que no se hayan limpiado.
  for (const id of orgs) purgePaymentsWhere(`organization_id = '${id}'`);
  purgeAuditLogWhere(`after->>'slug' like '${PREFIJO}-%'`);
  for (const id of orgs) await deleteOrg(service, id);
  for (const a of archivos) await service.storage.from(a.bucket).remove([a.path]);
  for (const u of users) await deleteUser(service, u);
});

describe("quién puede: solo SuperAdmin, solo por el servidor", () => {
  it("ni una sesión (ni la de un SuperAdmin) ni anon llaman la función por la API; ni anon, ni authenticated, ni public tienen EXECUTE", async () => {
    const local = await crearLocal();
    await darDeBaja(local);
    for (const [nombre, db, actor] of [
      ["SuperAdmin con sesión", admin.db, admin.id],
      ["Dueño", local.owner.db, local.owner.id],
      ["Staff", local.staff.db, local.staff.id],
      ["anon", anonClient(), admin.id],
    ] as const) {
      const r = await db.rpc("admin_delete_organization", { p_actor: actor, p_org: local.id, p_slug: local.slug, p_reason: "x" });
      expect(r.error?.code, nombre).toBe("42501");
    }
    expect(existe(local.id)).toBe(true);
    expect(await borrados(local.id)).toHaveLength(0);

    const [fila] = sql(`
      select has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
             has_function_privilege('service_role', p.oid, 'execute'), has_function_privilege('public', p.oid, 'execute'),
             p.prosecdef, pg_get_userbyid(p.proowner)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_delete_organization'`);
    expect(fila).toEqual(["f", "f", "t", "f", "t", "postgres"]);
  });

  it("una cuenta común no es SuperAdmin: el módulo la rechaza, y la función con service_role también (not_platform_admin)", async () => {
    const local = await crearLocal();
    await darDeBaja(local);
    expect(await borrar(local, {}, comun)).toEqual({ ok: false, error: "forbidden" });
    expect(await borrar(local, {}, local.owner)).toEqual({ ok: false, error: "forbidden" });
    for (const actor of [comun.id, local.owner.id, randomUUID(), null]) {
      const r = await directa(local.id, local.slug, "x", actor);
      expect(r.error?.message, String(actor)).toBe("not_platform_admin");
    }
    expect(existe(local.id)).toBe(true);
    expect(historial(local.id)).toBe(3);
    expect(await borrados(local.id)).toHaveLength(0);
  });
});

describe("el historial de promociones (ficha promociones-y-precio-efectivo)", () => {
  it("la función real de borrado lo purga en la misma transacción, lo cuenta en la auditoría y el resumen, y se lleva las promociones", async () => {
    const local = await crearLocal(2);
    const vecina = await crearLocal(1);
    await conPromociones(local);
    await conPromociones(vecina);
    await darDeBaja(local, "31 days");

    const r = await directa(local.id, local.slug, "Cerró hace meses");
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ price_history_purged: 2, promotion_history_purged: 3 });

    expect(existe(local.id)).toBe(false);
    for (const tabla of ["promotions", "promotion_targets", "promotion_history"]) expect(cuenta(tabla, local.id), tabla).toBe(0);
    const hechos = await borrados(local.id);
    expect(hechos).toHaveLength(1);
    expect(hechos[0].after).toMatchObject({ price_history_purged: 2, promotion_history_purged: 3 });
    expect(triggersEncendidos()).toBe(true);

    // La vecina conserva sus promociones y su historial.
    expect(cuenta("promotions", vecina.id)).toBe(1);
    expect(cuenta("promotion_history", vecina.id)).toBe(3);
  });

  it("si el borrado se rechaza (baja de menos de 30 días) o la transacción se deshace, el historial queda entero y el trigger encendido", async () => {
    const reciente = await crearLocal(1);
    await conPromociones(reciente);
    await darDeBaja(reciente, "5 days");
    expect(await borrar(reciente)).toEqual({ ok: false, error: "deactivation_too_recent" });
    expect(cuenta("promotion_history", reciente.id)).toBe(3);

    const local = await crearLocal(1);
    await conPromociones(local);
    await darDeBaja(local);
    expect(() =>
      sql(`begin; select public.admin_delete_organization('${admin.id}', '${local.id}', '${local.slug}', 'x'); select 1/0; commit`),
    ).toThrow(/division by zero/);
    expect(existe(local.id)).toBe(true);
    expect(cuenta("promotion_history", local.id)).toBe(3);
    expect(cuenta("promotions", local.id)).toBe(1);
    expect(triggersEncendidos()).toBe(true);
  });

  it("la función de purga no la ejecuta nadie de la API, y rechaza una organización activa", async () => {
    const local = await crearLocal(1);
    await conPromociones(local);
    // Ningún rol de la API (ni service_role, ni PUBLIC) ejecuta la purga ni las funciones del historial; las políticas y la API no pueden llamarlas.
    for (const funcion of [
      "private.purge_organization_promotion_history(uuid)",
      "private.record_promotion_change()",
      "private.promotion_history_append_only()",
    ]) {
      for (const rol of ["anon", "authenticated", "service_role", "public"]) {
        expect(sql(`select has_function_privilege('${rol}', '${funcion}', 'execute')`)[0][0], `${rol} ${funcion}`).toBe("f");
      }
    }
    expect(() => sql(`select private.purge_organization_promotion_history('${local.id}')`)).toThrow(/organization_still_active/);
    expect(cuenta("promotion_history", local.id)).toBe(3);
  });
});

describe("el registro de pedidos (ficha pedidos-estados-y-registro)", () => {
  /** Un pedido con una línea entregada y cerrado, anotado por el Dueño: deja 5 eventos (opened, added, in_kitchen, delivered, closed). */
  async function conPedidos(local: Local) {
    const mesa = await service.from("tables").insert({ organization_id: local.id, branch_id: (await service.from("branches").select("id").eq("organization_id", local.id).single()).data!.id, label: "Mesa 1" }).select("id, branch_id").single();
    if (mesa.error) throw new Error(`mesa: ${mesa.error.message}`);
    const r = await local.owner.db.rpc("add_order_item", { p_branch: mesa.data.branch_id, p_table: mesa.data.id, p_product: local.productId, p_quantity: 1, p_client_key: randomUUID() });
    if (r.error) throw new Error(`pedido: ${r.error.message}`);
    const { order_id: order, item_id: item } = r.data as { order_id: string; item_id: string };
    for (const estado of ["in_kitchen", "delivered"]) {
      const e = await local.owner.db.rpc("set_order_item_status", { p_item: item, p_status: estado });
      if (e.error) throw new Error(`estado: ${e.error.message}`);
    }
    const c = await local.owner.db.rpc("close_order", { p_order: order });
    if (c.error) throw new Error(`cierre: ${c.error.message}`);
  }

  it("la función real de borrado lo purga en la misma transacción, lo cuenta en la auditoría y el resumen, y se lleva los pedidos", async () => {
    const local = await crearLocal(1);
    const vecina = await crearLocal(1);
    await conPedidos(local);
    await conPedidos(vecina);
    expect(cuenta("order_events", local.id)).toBe(5);
    await darDeBaja(local, "31 days");

    const r = await directa(local.id, local.slug, "Cerró hace meses");
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ order_events_purged: 5, price_history_purged: 1 });

    expect(existe(local.id)).toBe(false);
    for (const tabla of ["orders", "order_items", "order_events"]) expect(cuenta(tabla, local.id), tabla).toBe(0);
    const hechos = await borrados(local.id);
    expect(hechos).toHaveLength(1);
    expect(hechos[0].after).toMatchObject({ order_events_purged: 5 });
    expect(triggersEncendidos()).toBe(true);

    // La vecina conserva sus pedidos y su registro.
    expect(cuenta("orders", vecina.id)).toBe(1);
    expect(cuenta("order_events", vecina.id)).toBe(5);
  });

  it("si el borrado se rechaza (baja de menos de 30 días) o la transacción se deshace, el registro queda entero y el trigger encendido", async () => {
    const reciente = await crearLocal(1);
    await conPedidos(reciente);
    await darDeBaja(reciente, "5 days");
    expect(await borrar(reciente)).toEqual({ ok: false, error: "deactivation_too_recent" });
    expect(cuenta("order_events", reciente.id)).toBe(5);

    const local = await crearLocal(1);
    await conPedidos(local);
    await darDeBaja(local);
    expect(() =>
      sql(`begin; select public.admin_delete_organization('${admin.id}', '${local.id}', '${local.slug}', 'x'); select 1/0; commit`),
    ).toThrow(/division by zero/);
    expect(existe(local.id)).toBe(true);
    expect(cuenta("order_events", local.id)).toBe(5);
    expect(cuenta("orders", local.id)).toBe(1);
    expect(triggersEncendidos()).toBe(true);
  });

  it("sin la purga el RESTRICT frena el borrado, y la función de purga no la ejecuta nadie de la API y rechaza una organización activa", async () => {
    const local = await crearLocal(1);
    await conPedidos(local);
    const directo = await service.from("organizations").delete().eq("id", local.id);
    expect(directo.error?.message).toMatch(/order_events|foreign key|restrict/i);
    expect(existe(local.id)).toBe(true);
    for (const funcion of ["private.purge_organization_order_events(uuid)", "private.record_order_event()", "private.order_events_append_only()"]) {
      for (const rol of ["anon", "authenticated", "service_role", "public"]) {
        expect(sql(`select has_function_privilege('${rol}', '${funcion}', 'execute')`)[0][0], `${rol} ${funcion}`).toBe("f");
      }
    }
    expect(() => sql(`select private.purge_organization_order_events('${local.id}')`)).toThrow(/organization_still_active/);
    expect(cuenta("order_events", local.id)).toBe(5);
  });
});

describe("rechazos: no dejan huella", () => {
  async function sinHuella(local: Local, antes: number) {
    expect(existe(local.id)).toBe(true);
    expect(historial(local.id)).toBe(3);
    expect(cuenta("branches", local.id)).toBe(1);
    expect(cuenta("memberships", local.id)).toBe(2);
    expect(await borrados(local.id)).toHaveLength(0);
    expect((await auditoria(local.id)).length).toBe(antes);
    expect(await existeArchivo("organization-logos", local.logo)).toBe(true);
    expect(await existeArchivo("product-images", local.fotos[0])).toBe(true);
    expect(triggersEncendidos()).toBe(true);
  }

  it("organización activa: organization_still_active", async () => {
    const local = await crearLocal();
    const antes = (await auditoria(local.id)).length;
    expect(await borrar(local)).toEqual({ ok: false, error: "organization_still_active" });
    expect((await directa(local.id, local.slug, "x")).error?.message).toBe("organization_still_active");
    await sinHuella(local, antes);
  });

  it("inactiva puesta a mano, sin baja auditada: deactivation_not_audited", async () => {
    const local = await crearLocal();
    sql(`update public.organizations set is_active = false where id = '${local.id}'`);
    const antes = (await auditoria(local.id)).length;
    expect(await borrar(local)).toEqual({ ok: false, error: "deactivation_not_audited" });
    await sinHuella(local, antes);
  });

  it("baja de menos de 30 días, también un minuto antes: deactivation_too_recent", async () => {
    const reciente = await crearLocal();
    await darDeBaja(reciente, "5 days");
    const antesReciente = (await auditoria(reciente.id)).length;
    expect(await borrar(reciente)).toEqual({ ok: false, error: "deactivation_too_recent" });
    await sinHuella(reciente, antesReciente);

    const justo = await crearLocal();
    await darDeBaja(justo, "29 days 23 hours 59 minutes");
    const antesJusto = (await auditoria(justo.id)).length;
    expect(await borrar(justo)).toEqual({ ok: false, error: "deactivation_too_recent" });
    await sinHuella(justo, antesJusto);
  });

  it("reactivada después de la baja: se rechaza aunque la baja sea vieja; si se vuelve a dar de baja, cuenta la nueva", async () => {
    const local = await crearLocal();
    await darDeBaja(local, "90 days");
    expect(await baja(local, true)).toEqual({ ok: true, data: undefined });
    expect(await borrar(local)).toEqual({ ok: false, error: "organization_still_active" });

    expect(await baja(local, false)).toEqual({ ok: true, data: undefined }); // nueva baja, de ahora
    const antes = (await auditoria(local.id)).length;
    expect(await borrar(local)).toEqual({ ok: false, error: "deactivation_too_recent" });
    expect((await auditoria(local.id)).length).toBe(antes);
    expect(existe(local.id)).toBe(true);
  });

  it("el slug escrito tiene que ser el de ESTA organización: otro slug, mayúsculas, vacío o el de otra organización", async () => {
    const local = await crearLocal();
    const otra = await crearLocal();
    await darDeBaja(local);
    await darDeBaja(otra);
    const antes = (await auditoria(local.id)).length;
    for (const confirmSlug of ["", "otro-local", local.slug.toUpperCase(), otra.slug, `${local.slug}-x`]) {
      expect(await borrar(local, { confirmSlug }), confirmSlug).toEqual({ ok: false, error: "slug_mismatch" });
    }
    // Directo a la base (sin el módulo): la función lo comprueba sola.
    for (const slug of ["", "otro-local", local.slug.toUpperCase(), otra.slug]) {
      expect((await directa(local.id, slug, "x")).error?.message, slug).toBe("slug_mismatch");
    }
    expect((await directa(local.id, null as unknown as string, "x")).error?.message).toBe("slug_mismatch");
    await sinHuella(local, antes);
    expect(existe(otra.id)).toBe(true);
  });

  it("motivo vacío, de más de 200 caracteres o nulo: invalid_reason, en el módulo y en la base", async () => {
    const local = await crearLocal();
    await darDeBaja(local);
    const antes = (await auditoria(local.id)).length;
    for (const reason of ["", "   ", "M".repeat(201)]) {
      expect(await borrar(local, { reason }), reason.length.toString()).toEqual({ ok: false, error: "invalid_reason" });
      expect((await directa(local.id, local.slug, reason)).error?.message).toBe("invalid_reason");
    }
    expect((await directa(local.id, local.slug, null)).error?.message).toBe("invalid_reason");
    await sinHuella(local, antes);
  });

  it("una organización inexistente: org_not_found / organization_not_found", async () => {
    expect(await deleteOrganization(ctx(admin), { slug: `${PREFIJO}-no-existe-${sufijo}`, confirmSlug: `${PREFIJO}-no-existe-${sufijo}`, reason: "x" })).toEqual({
      ok: false,
      error: "org_not_found",
    });
    expect((await directa(randomUUID(), "no-existe", "x")).error?.message).toBe("organization_not_found");
  });
});

describe("el borrado", () => {
  it("borra la organización y todo lo suyo, deja una sola auditoría con slug y nombre, y devuelve el resumen", async () => {
    const local = await crearLocal(3);
    const vecina = await crearLocal(2);
    await conPagos(local);
    await darDeBaja(local, "31 days");

    const r = await borrar(local, { reason: "Cerró hace meses" });
    expect(r).toMatchObject({ ok: true, data: { slug: local.slug, priceHistoryPurged: 3, paymentsKept: 2, files: { removed: 2, complete: true } } });

    // La organización y todo lo que colgaba de ella.
    expect(existe(local.id)).toBe(false);
    for (const tabla of ["branches", "categories", "products", "memberships", "subscriptions", "price_history"]) {
      expect(cuenta(tabla, local.id), tabla).toBe(0);
    }
    // Una sola auditoría, con el actor, el slug, el nombre, el motivo y las cifras.
    const hechos = await borrados(local.id);
    expect(hechos).toHaveLength(1);
    expect(hechos[0]).toMatchObject({ actor_id: admin.id, organization_id: local.id });
    expect(hechos[0].after).toMatchObject({
      slug: local.slug,
      name: local.slug,
      reason: "Cerró hace meses",
      price_history_purged: 3,
      branches: 1,
      products: 1,
      memberships: 2,
      payments_kept: 2,
      voids_kept: 1,
    });
    expect(hechos[0].before).toMatchObject({ slug: local.slug, name: local.slug, active: false });
    // Las auditorías anteriores siguen (la baja, los pagos).
    const acciones = (await auditoria(local.id)).map((a) => a.action);
    expect(acciones).toEqual(expect.arrayContaining(["organization.deactivated", "payment.registered", "payment.voided", "organization.deleted"]));
    expect(triggersEncendidos()).toBe(true);

    // La vecina, intacta.
    expect(existe(vecina.id)).toBe(true);
    expect(historial(vecina.id)).toBe(2);
    expect(cuenta("branches", vecina.id)).toBe(1);
    expect(await existeArchivo("organization-logos", vecina.logo)).toBe(true);
    expect(await existeArchivo("product-images", vecina.fotos[0])).toBe(true);
  });

  it("conserva los pagos y las anulaciones (ADR 0027), sin organización ni suscripción, y el SuperAdmin los sigue leyendo", async () => {
    const local = await crearLocal();
    const { pagos, anulacion } = await conPagos(local);
    await darDeBaja(local);
    expect((await borrar(local)).ok).toBe(true);

    const filas = await service.from("payments").select("id, organization_id, amount_cents").in("id", pagos);
    expect(filas.data).toHaveLength(2);
    expect(filas.data!.every((p) => p.organization_id === local.id)).toBe(true);
    const vacios = await service.from("payment_voids").select("id").eq("id", anulacion);
    expect(vacios.data).toHaveLength(1);
    expect(triggerEncendido("payments_no_update_delete")).toBe(true);
    expect(triggerEncendido("payment_voids_no_update_delete")).toBe(true);
    // El SuperAdmin los lee por la tabla (RLS); ninguna organización los ve.
    expect((await admin.db.from("payments").select("id").in("id", pagos)).data).toHaveLength(2);
    expect((await comun.db.from("payments").select("id").in("id", pagos)).data).toHaveLength(0);
  });

  it("no borra las cuentas del Dueño ni del Staff; solo sus membresías", async () => {
    const local = await crearLocal();
    await darDeBaja(local);
    expect((await borrar(local)).ok).toBe(true);
    for (const u of [local.owner, local.staff]) {
      const cuentaAuth = await service.auth.admin.getUserById(u.id);
      expect(cuentaAuth.data.user?.id, u.id).toBe(u.id);
    }
    expect(cuenta("memberships", local.owner.id, "user_id")).toBe(0);
  });

  it("borra solo los archivos de ESA organización, en los dos buckets (carpetas de platos incluidas)", async () => {
    const local = await crearLocal();
    const segundaFoto = `${local.id}/${local.productId}/${randomUUID()}.png`;
    await subir("product-images", segundaFoto);
    const vecina = await crearLocal();
    await darDeBaja(local);

    const r = await borrar(local);
    expect(r).toMatchObject({ ok: true, data: { files: { removed: 3, complete: true } } });
    expect(await existeArchivo("organization-logos", local.logo)).toBe(false);
    expect(await existeArchivo("product-images", local.fotos[0])).toBe(false);
    expect(await existeArchivo("product-images", segundaFoto)).toBe(false);
    expect(await existeArchivo("organization-logos", vecina.logo)).toBe(true);
    expect(await existeArchivo("product-images", vecina.fotos[0])).toBe(true);
  });

  it("una organización sin historial, sin archivos y sin pagos también se borra", async () => {
    const local = await crearLocal(0);
    await service.storage.from("organization-logos").remove([local.logo]);
    await service.storage.from("product-images").remove(local.fotos);
    await darDeBaja(local);
    expect(await borrar(local)).toMatchObject({ ok: true, data: { priceHistoryPurged: 0, paymentsKept: 0, files: { removed: 0, complete: true } } });
    expect(existe(local.id)).toBe(false);
  });

  it("el slug se puede reutilizar y la organización nueva no hereda los pagos ni la auditoría de la borrada", async () => {
    const local = await crearLocal();
    await conPagos(local);
    await darDeBaja(local);
    expect((await borrar(local)).ok).toBe(true);

    const nuevoId = await createOrg(service, local.slug);
    orgs.push(nuevoId);
    expect(nuevoId).not.toBe(local.id);
    expect(cuenta("payments", nuevoId)).toBe(0);
    expect((await auditoria(nuevoId)).filter((a) => a.action === "organization.deleted")).toHaveLength(0);
    const detalle = await getOrganizationDetail(ctx(admin), local.slug);
    expect(detalle.ok && detalle.data.payments).toEqual([]);
  });

  it("después, la ficha de la organización ya no existe y la carta pública responde como una inexistente", async () => {
    const local = await crearLocal();
    await darDeBaja(local);
    expect((await borrar(local)).ok).toBe(true);
    expect(await getOrganizationDetail(ctx(admin), local.slug)).toEqual({ ok: false, error: "org_not_found" });
    const estado = await anonClient().rpc("public_menu_status", { p_org_slug: local.slug, p_branch_slug: "principal" });
    expect(estado.data ?? null).toBeNull();
    expect(await borrar(local)).toEqual({ ok: false, error: "org_not_found" });
  });
});

describe("la ficha: de cuándo corre el plazo (deactivatedAt)", () => {
  it("nula si está activa o si la baja fue a mano; la fecha de la baja auditada si está de baja; nula tras reactivar", async () => {
    const local = await crearLocal();
    const detalle = async () => {
      const r = await getOrganizationDetail(ctx(admin), local.slug);
      if (!r.ok) throw new Error(r.error);
      return r.data.deactivatedAt;
    };
    expect(await detalle()).toBeNull();

    await darDeBaja(local, "40 days");
    const desde = await detalle();
    expect(desde).not.toBeNull();
    expect(Date.now() - new Date(desde!).getTime()).toBeGreaterThan(39 * DIA_MS);
    expect(Date.now() - new Date(desde!).getTime()).toBeLessThan(41 * DIA_MS);

    expect(await baja(local, true)).toEqual({ ok: true, data: undefined });
    expect(await detalle()).toBeNull();

    const manual = await crearLocal();
    sql(`update public.organizations set is_active = false where id = '${manual.id}'`);
    const r = await getOrganizationDetail(ctx(admin), manual.slug);
    expect(r.ok && r.data.deactivatedAt).toBeNull();
  });
});

describe("atomicidad: o se hace todo o no se hace nada", () => {
  it("si la transacción que llama a la función falla después, no se borra nada ni queda auditoría ni apagado ningún trigger", async () => {
    const local = await crearLocal(3);
    await conPagos(local);
    await darDeBaja(local);
    const antes = (await auditoria(local.id)).length;

    expect(() =>
      sql(`begin; select public.admin_delete_organization('${admin.id}', '${local.id}', '${local.slug}', 'x'); select 1/0; commit`),
    ).toThrow(/division by zero/);

    expect(existe(local.id)).toBe(true);
    expect(historial(local.id)).toBe(3);
    expect(cuenta("branches", local.id)).toBe(1);
    expect(cuenta("memberships", local.id)).toBe(2);
    expect(cuenta("payments", local.id)).toBe(2);
    expect((await auditoria(local.id)).length).toBe(antes);
    expect(triggersEncendidos()).toBe(true);
  });

  it("un ROLLBACK explícito después de borrar también lo devuelve todo", async () => {
    const local = await crearLocal(2);
    await darDeBaja(local);
    sql(`begin; select public.admin_delete_organization('${admin.id}', '${local.id}', '${local.slug}', 'x'); rollback`);
    expect(existe(local.id)).toBe(true);
    expect(historial(local.id)).toBe(2);
    expect(await borrados(local.id)).toHaveLength(0);
    expect(triggersEncendidos()).toBe(true);
  });
});

describe("concurrencia", () => {
  it("dos borrados a la vez: uno borra y el otro dice que ya no existe; una sola auditoría y los pagos intactos", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const local = await crearLocal(2);
      await conPagos(local);
      await darDeBaja(local);
      const [a, b] = await Promise.all([borrar(local), borrar(local)]);
      const exitos = [a, b].filter((r) => r.ok);
      expect(exitos, `ronda ${ronda}`).toHaveLength(1);
      const perdedor = [a, b].find((r) => !r.ok)!;
      expect(perdedor).toEqual({ ok: false, error: "org_not_found" });
      expect(await borrados(local.id)).toHaveLength(1);
      expect(existe(local.id)).toBe(false);
      expect(cuenta("payments", local.id)).toBe(2);
    }
  }, 60_000);

  it("un pago que se está registrando a la vez: el borrado espera su lock y cuenta ese pago entre los conservados", async () => {
    const local = await crearLocal(1);
    await darDeBaja(local);
    const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
    asegurarDestinoLocal(contenedor);
    // El pago queda dentro de una transacción abierta (dormida) que ya tomó el lock de la suscripción.
    const lenta = execFileAsync(
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
        `begin; select public.admin_register_payment('${admin.id}', '${local.id}', 1000, 'ARS', 'cash', '', current_date - 1, now() + interval '90 days'); select pg_sleep(3); commit`,
      ],
      { encoding: "utf8" },
    );
    let durmiendo = false;
    for (let intento = 0; intento < 50 && !durmiendo; intento++) {
      durmiendo = sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${local.id}%'`)[0][0] === "1";
      if (!durmiendo) await new Promise((r) => setTimeout(r, 100));
    }
    expect(durmiendo).toBe(true);

    const inicio = Date.now();
    const r = await borrar(local);
    const esperado = Date.now() - inicio;
    await lenta;

    expect(r.ok).toBe(true);
    expect(esperado).toBeGreaterThan(500); // esperó el lock de la suscripción
    expect((await borrados(local.id))[0].after).toMatchObject({ payments_kept: 1 });
    expect(cuenta("payments", local.id)).toBe(1);
  }, 30_000);

  it("un borrado y una reactivación a la vez: gana uno solo y el resultado es coherente (no queda borrada y reactivada)", async () => {
    for (let ronda = 0; ronda < 4; ronda++) {
      const local = await crearLocal(1);
      await darDeBaja(local);
      const [borrada, reactivada] = await Promise.all([borrar(local), baja(local, true)]);
      if (borrada.ok) {
        // Borró primero: la reactivación ya no encuentra la organización.
        expect(reactivada, `ronda ${ronda}`).toEqual({ ok: false, error: "org_not_found" });
        expect(existe(local.id)).toBe(false);
        expect(await borrados(local.id)).toHaveLength(1);
      } else {
        // Reactivó primero: el borrado ve la organización activa y no toca nada.
        expect(borrada, `ronda ${ronda}`).toEqual({ ok: false, error: "organization_still_active" });
        expect(reactivada.ok).toBe(true);
        expect(existe(local.id)).toBe(true);
        expect(activa(local.id)).toBe(true);
        expect(historial(local.id)).toBe(1);
        expect(await borrados(local.id)).toHaveLength(0);
      }
    }
  }, 60_000);
});
