import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Aviso de llamados con la pestaña cerrada (nivel C; ficha aviso-push-de-llamados, ADR 0020) contra el Supabase local:
 * la tabla de suscripciones es un secreto sin acceso directo, solo un miembro registra su dispositivo (con plan y cuenta
 * al día, y solo hacia servicios de push conocidos), quitar a alguien del local borra sus suscripciones y el servidor
 * recibe únicamente los destinos de los miembros de ESA organización por un llamado recién creado.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser;
const orgs: string[] = [];

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const endpointNuevo = () => `https://fcm.googleapis.com/fcm/send/rls-${randomUUID()}`;

type Local = { id: string; branch: string; table: string; token: string };

async function nuevoLocal(slug: string, plan: "basic" | "pro" = "pro"): Promise<Local> {
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  const branch = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  if (branch.error) throw new Error(branch.error.message);
  const table = await service
    .from("tables")
    .insert({ organization_id: id, branch_id: branch.data.id, label: "Mesa 7" })
    .select("id, qr_token")
    .single();
  if (table.error) throw new Error(table.error.message);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: branch.data.id, table: table.data.id, token: table.data.qr_token };
}

const registrar = async (db: Db, org: string, endpoint = endpointNuevo(), keys: { p256dh?: string; auth?: string } = {}) => {
  const result = await db.rpc("register_push_subscription", {
    p_org: org,
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh ?? P256DH,
    p_auth: keys.auth ?? AUTH,
  });
  return { endpoint, ...result };
};

const filas = (org: string, endpoint?: string) =>
  sql(
    `select id, user_id from public.push_subscriptions where organization_id = '${org}'${endpoint ? ` and endpoint = '${endpoint}'` : ""} order by registered_at`,
  );

/** Un llamado de verdad, por la única puerta pública. */
async function llamar(local: Local, kind: "waiter" | "bill" = "waiter") {
  const { data, error } = await anonClient().rpc("create_waiter_call", { p_token: local.token, p_kind: kind });
  if (error) throw new Error(error.message);
  expect(data).toEqual({ status: "created" });
}

const destinos = (token: string, kind = "waiter", db: Db = service) => db.rpc("push_targets_for_call", { p_token: token, p_kind: kind });

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ajeno] = await Promise.all([
    createUser(service, "push-owner"),
    createUser(service, "push-staff"),
    createUser(service, "push-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, ajeno].map((u) => deleteUser(service, u)));
});

describe("la tabla de suscripciones es un secreto", () => {
  it("anon, miembros y hasta service_role no pueden leerla, escribirla ni borrarla por la API", async () => {
    const local = await nuevoLocal("tt-push-cerrada");
    const { endpoint } = await registrar(staff.db, local.id);
    expect(filas(local.id, endpoint)).toHaveLength(1);

    for (const db of [anonClient(), owner.db, staff.db, service]) {
      const leer = await db.from("push_subscriptions").select("*");
      expect(leer.error?.code).toBe("42501");
      const crear = await db.from("push_subscriptions").insert({
        organization_id: local.id,
        user_id: staff.id,
        endpoint: endpointNuevo(),
        p256dh: P256DH,
        auth_secret: AUTH,
      });
      expect(crear.error?.code).toBe("42501");
      expect((await db.from("push_subscriptions").update({ user_id: owner.id }).eq("organization_id", local.id)).error?.code).toBe("42501");
      expect((await db.from("push_subscriptions").delete().eq("organization_id", local.id)).error?.code).toBe("42501");
    }
    expect(filas(local.id, endpoint)).toHaveLength(1);
  });

  it("la base misma rechaza una dirección fuera de los servicios de push, aunque se escriba directo", () => {
    const local = sql(`select id from public.organizations limit 1`)[0][0];
    const user = sql(`select user_id from public.memberships where organization_id = '${local}' limit 1`)[0][0];
    for (const mala of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://169.254.169.254/x", "https://fcm.googleapis.com@evil.example/x"]) {
      expect(() =>
        sql(
          `insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth_secret) values ('${local}', '${user}', '${mala}', '${P256DH}', '${AUTH}')`,
        ),
      ).toThrow();
    }
  });
});

describe("registrar el dispositivo", () => {
  it("un miembro (Staff o Dueño) registra el suyo; queda atado a su cuenta y a ese local", async () => {
    const local = await nuevoLocal("tt-push-registra");
    for (const user of [staff, owner]) {
      const r = await registrar(user.db, local.id);
      expect(r.error).toBeNull();
      expect(r.data).toBe("ok");
      expect(filas(local.id, r.endpoint)).toEqual([[expect.any(String), user.id]]);
    }
  });

  it("anon no puede ejecutarla; quien no es miembro de ese local recibe «unavailable» y no queda nada", async () => {
    const local = await nuevoLocal("tt-push-no-miembro");
    expect((await registrar(anonClient(), local.id)).error?.code).toBe("42501");
    const r = await registrar(ajeno.db, local.id);
    expect(r.data).toBe("unavailable");
    expect(filas(local.id, r.endpoint)).toHaveLength(0);
  });

  it("un miembro de otro local no registra en este", async () => {
    const a = await nuevoLocal("tt-push-cruce-a");
    const b = await nuevoLocal("tt-push-cruce-b");
    await addMembership(service, ajeno, b.id, "staff");
    expect((await registrar(ajeno.db, b.id)).data).toBe("ok");
    expect((await registrar(ajeno.db, a.id)).data).toBe("unavailable");
  });

  it("sin el plan o con la cuenta suspendida no se registra: «unavailable»", async () => {
    const basico = await nuevoLocal("tt-push-basico", "basic");
    expect((await registrar(staff.db, basico.id)).data).toBe("unavailable");

    const local = await nuevoLocal("tt-push-mora");
    expect((await registrar(staff.db, local.id)).data).toBe("ok");
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS });
    expect((await registrar(staff.db, local.id)).data).toBe("unavailable");
  });

  it.each([
    ["http plano", "http://fcm.googleapis.com/fcm/send/x"],
    ["otro host", "https://evil.example/fcm/send/x"],
    ["servicio interno", "https://169.254.169.254/latest"],
    ["credenciales en la URL", "https://fcm.googleapis.com@evil.example/x"],
    ["con puerto", "https://fcm.googleapis.com:8443/x"],
    ["con barra invertida", "https://fcm.googleapis.com\\@evil.example/x"],
    ["sufijo engañoso", "https://fcm.googleapis.com.evil.example/x"],
    ["demasiado larga", `https://fcm.googleapis.com/${"a".repeat(1000)}`],
  ])("rechaza una dirección: %s", async (_nombre, endpoint) => {
    const local = await nuevoLocal(`tt-push-ssrf-${randomUUID().slice(0, 8)}`);
    const r = await registrar(staff.db, local.id, endpoint);
    expect(r.data).toBe("invalid");
    expect(filas(local.id)).toHaveLength(0);
  });

  it.each([
    ["p256dh corta", { p256dh: "abc" }],
    ["p256dh con símbolos", { p256dh: `${"B".repeat(86)}!` }],
    ["auth corta", { auth: "abc" }],
    ["auth larguísima", { auth: "a".repeat(200) }],
  ])("rechaza claves mal formadas: %s", async (_nombre, keys) => {
    const local = await nuevoLocal(`tt-push-claves-${randomUUID().slice(0, 8)}`);
    expect((await registrar(staff.db, local.id, endpointNuevo(), keys)).data).toBe("invalid");
    expect(filas(local.id)).toHaveLength(0);
  });

  it("como mucho 10 dispositivos por persona y local; refrescar uno ya registrado sigue valiendo", async () => {
    const local = await nuevoLocal("tt-push-tope");
    const registrados: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await registrar(staff.db, local.id);
      expect(r.data).toBe("ok");
      registrados.push(r.endpoint);
    }
    expect((await registrar(staff.db, local.id)).data).toBe("limit");
    expect((await registrar(staff.db, local.id, registrados[0])).data).toBe("ok");
    // El tope es por persona: el Dueño tiene el suyo.
    expect((await registrar(owner.db, local.id)).data).toBe("ok");
    expect(filas(local.id)).toHaveLength(11);
  });

  it("el mismo dispositivo en otra cuenta pasa a quien lo usa ahora; la anterior deja de tenerlo", async () => {
    const local = await nuevoLocal("tt-push-cambio-cuenta");
    const { endpoint } = await registrar(staff.db, local.id);
    expect((await registrar(owner.db, local.id, endpoint)).data).toBe("ok");
    expect(filas(local.id, endpoint)).toEqual([[expect.any(String), owner.id]]);
    expect((await staff.db.rpc("push_subscription_registered", { p_org: local.id, p_endpoint: endpoint })).data).toBe(false);
    expect((await owner.db.rpc("push_subscription_registered", { p_org: local.id, p_endpoint: endpoint })).data).toBe(true);
  });
});

describe("consultar y quitar el propio dispositivo", () => {
  it("«registrado» solo mira lo propio y por local", async () => {
    const a = await nuevoLocal("tt-push-estado-a");
    const b = await nuevoLocal("tt-push-estado-b");
    const { endpoint } = await registrar(staff.db, a.id);
    const registrado = (db: Db, org: string) => db.rpc("push_subscription_registered", { p_org: org, p_endpoint: endpoint });
    expect((await registrado(staff.db, a.id)).data).toBe(true);
    expect((await registrado(staff.db, b.id)).data).toBe(false);
    expect((await registrado(owner.db, a.id)).data).toBe(false); // el Dueño no ve la del Staff
    expect((await registrado(anonClient(), a.id)).error?.code).toBe("42501");
  });

  it("quitar borra solo las propias: el Dueño no puede quitar el dispositivo del Staff", async () => {
    const local = await nuevoLocal("tt-push-quitar");
    const { endpoint } = await registrar(staff.db, local.id);
    expect((await owner.db.rpc("unregister_push_subscription", { p_endpoint: endpoint, p_org: local.id })).error).toBeNull();
    expect((await owner.db.rpc("unregister_push_subscription", { p_endpoint: endpoint })).error).toBeNull();
    expect(filas(local.id, endpoint)).toHaveLength(1);
    expect((await anonClient().rpc("unregister_push_subscription", { p_endpoint: endpoint })).error?.code).toBe("42501");

    expect((await staff.db.rpc("unregister_push_subscription", { p_endpoint: endpoint, p_org: local.id })).error).toBeNull();
    expect(filas(local.id, endpoint)).toHaveLength(0);
  });

  it("sin local quita el dispositivo de todos los locales de la persona (al cerrar sesión)", async () => {
    const a = await nuevoLocal("tt-push-todos-a");
    const b = await nuevoLocal("tt-push-todos-b");
    const endpoint = endpointNuevo();
    await registrar(staff.db, a.id, endpoint);
    await registrar(staff.db, b.id, endpoint);
    await staff.db.rpc("unregister_push_subscription", { p_endpoint: endpoint });
    expect(filas(a.id, endpoint)).toHaveLength(0);
    expect(filas(b.id, endpoint)).toHaveLength(0);
  });
});

describe("quitar a alguien del local borra sus suscripciones", () => {
  it("al quitar la membresía, o la cuenta, el dispositivo ya no recibe nada", async () => {
    const local = await nuevoLocal("tt-push-baja");
    await addMembership(service, ajeno, local.id, "staff");
    const a = await registrar(staff.db, local.id);
    const b = await registrar(ajeno.db, local.id);
    expect(filas(local.id)).toHaveLength(2);

    await service.from("memberships").delete().eq("organization_id", local.id).eq("user_id", ajeno.id);
    expect(filas(local.id, b.endpoint)).toHaveLength(0);
    expect(filas(local.id, a.endpoint)).toHaveLength(1);

    const otro = await createUser(service, "push-baja-cuenta");
    await addMembership(service, otro, local.id, "staff");
    await registrar(otro.db, local.id);
    expect(filas(local.id)).toHaveLength(2);
    await deleteUser(service, otro);
    expect(filas(local.id)).toHaveLength(1);
  });
});

describe("a quién avisa el servidor", () => {
  it("solo service_role puede pedir los destinos; anon y miembros no", async () => {
    const local = await nuevoLocal("tt-push-destinos-permiso");
    await registrar(staff.db, local.id);
    await llamar(local);
    for (const db of [anonClient(), owner.db, staff.db]) {
      expect((await destinos(local.token, "waiter", db)).error?.code).toBe("42501");
    }
    expect((await destinos(local.token)).error).toBeNull();
  });

  it("devuelve lo que arma el aviso y las suscripciones de ESE local, sin ids de mesa ni de organización", async () => {
    const local = await nuevoLocal("tt-push-destinos");
    const otro = await nuevoLocal("tt-push-destinos-otro");
    const mia = await registrar(staff.db, local.id);
    const delDueno = await registrar(owner.db, local.id);
    await registrar(staff.db, otro.id); // otro local: no debe aparecer
    await llamar(local);

    const { data, error } = await destinos(local.token);
    expect(error).toBeNull();
    const respuesta = data as { slug: string; table_label: string; branch_name: string; multi_branch: boolean; subscriptions: { endpoint: string; p256dh: string; auth: string }[] };
    expect(Object.keys(respuesta).sort()).toEqual(["branch_name", "multi_branch", "slug", "subscriptions", "table_label"]);
    expect(respuesta).toMatchObject({ slug: "tt-push-destinos", table_label: "Mesa 7", branch_name: "Uno", multi_branch: false });
    expect(respuesta.subscriptions.map((s) => s.endpoint).sort()).toEqual([mia.endpoint, delDueno.endpoint].sort());
    expect(respuesta.subscriptions[0]).toMatchObject({ p256dh: P256DH, auth: AUTH });
    expect(JSON.stringify(respuesta)).not.toContain(local.id);
    expect(JSON.stringify(respuesta)).not.toContain(local.table);
  });

  it("marca si el local tiene más de una sucursal activa", async () => {
    const local = await nuevoLocal("tt-push-sucursales");
    await registrar(staff.db, local.id);
    await service.from("branches").insert({ organization_id: local.id, slug: "dos", name: "Dos" });
    await llamar(local);
    expect(((await destinos(local.token)).data as { multi_branch: boolean }).multi_branch).toBe(true);
  });

  it("sin un llamado pendiente reciente de esa mesa y tipo no devuelve nada (no sirve para avisar «porque sí»)", async () => {
    const local = await nuevoLocal("tt-push-sin-llamado");
    await registrar(staff.db, local.id);
    expect((await destinos(local.token)).data).toBeNull();

    await llamar(local, "waiter");
    expect((await destinos(local.token, "bill")).data).toBeNull(); // hay uno de mozo, no de cuenta
    expect((await destinos(local.token, "waiter")).data).not.toBeNull();

    // Pasados 2 minutos ya no corresponde avisar.
    await service.from("waiter_calls").update({ created_at: new Date(Date.now() - 3 * 60_000).toISOString() }).eq("table_id", local.table);
    expect((await destinos(local.token, "waiter")).data).toBeNull();
  });

  it("un llamado atendido o vencido no avisa", async () => {
    const local = await nuevoLocal("tt-push-atendido");
    await registrar(staff.db, local.id);
    await llamar(local);
    await service.from("waiter_calls").update({ status: "attended", attended_at: new Date().toISOString() }).eq("table_id", local.table);
    expect((await destinos(local.token)).data).toBeNull();
  });

  it("no avisa si la mesa, la sucursal o la organización están inactivas, ni sin el plan o con la cuenta suspendida", async () => {
    const local = await nuevoLocal("tt-push-inactivo");
    await registrar(staff.db, local.id);
    await llamar(local);
    expect((await destinos(local.token)).data).not.toBeNull();

    await service.from("tables").update({ is_active: false }).eq("id", local.table);
    expect((await destinos(local.token)).data).toBeNull();
    await service.from("tables").update({ is_active: true }).eq("id", local.table);

    await service.from("branches").update({ is_active: false }).eq("id", local.branch);
    expect((await destinos(local.token)).data).toBeNull();
    await service.from("branches").update({ is_active: true }).eq("id", local.branch);

    await service.from("organizations").update({ is_active: false }).eq("id", local.id);
    expect((await destinos(local.token)).data).toBeNull();
    await service.from("organizations").update({ is_active: true }).eq("id", local.id);

    await setSubscription(service, local.id, { plan: "basic" });
    expect((await destinos(local.token)).data).toBeNull();
    await setSubscription(service, local.id, { plan: "pro" });
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS });
    expect((await destinos(local.token)).data).toBeNull();
  });

  it("un token inexistente, mal formado o un tipo inválido no devuelve nada ni falla", async () => {
    const local = await nuevoLocal("tt-push-token");
    await registrar(staff.db, local.id);
    await llamar(local);
    for (const token of ["0".repeat(32), "no-es-un-token", "", local.token.toUpperCase()]) {
      const r = await destinos(token);
      expect(r.error).toBeNull();
      expect(r.data).toBeNull();
    }
    expect((await destinos(local.token, "otro")).data).toBeNull();
  });

  it("el local sin dispositivos devuelve la lista vacía", async () => {
    const local = await nuevoLocal("tt-push-sin-dispositivos");
    await llamar(local);
    expect(((await destinos(local.token)).data as { subscriptions: unknown[] }).subscriptions).toEqual([]);
  });
});

describe("limpiar suscripciones muertas", () => {
  it("solo service_role; borra por id y no toca las demás", async () => {
    const local = await nuevoLocal("tt-push-limpieza");
    const a = await registrar(staff.db, local.id);
    const b = await registrar(owner.db, local.id);
    const idA = filas(local.id, a.endpoint)[0][0];

    for (const db of [anonClient(), owner.db, staff.db]) {
      expect((await db.rpc("drop_push_subscriptions", { p_ids: [idA] })).error?.code).toBe("42501");
    }
    expect(filas(local.id)).toHaveLength(2);

    expect((await service.rpc("drop_push_subscriptions", { p_ids: [idA] })).data).toBe(1);
    expect(filas(local.id, a.endpoint)).toHaveLength(0);
    expect(filas(local.id, b.endpoint)).toHaveLength(1);
    expect((await service.rpc("drop_push_subscriptions", { p_ids: [] })).data).toBe(0);
  });
});
