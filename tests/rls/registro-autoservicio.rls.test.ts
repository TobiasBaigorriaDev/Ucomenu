import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, anonClient, BRANCH_CAFE, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, ORG_CAFE, PRODUCT_ESPRESSO, serviceClient, sql, type Db, type TestUser } from "./helpers";

/**
 * Registro autoservicio y plan elegido al pagar (nivel C, ficha registro-autoservicio, ADR 0053) contra el Supabase local. El foco:
 * una cuenta sin local no gana nada frente a `anon`, solo un email confirmado crea un local, una prueba por persona, la purga no toca lo
 * que no debe, y el plan cambia únicamente al registrarse el pago.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TERMINOS = "2026-11-01";
let service: Db;
const users: TestUser[] = [];
const orgs: string[] = [];
const authIds: string[] = [];
let contador = 0;
let secuenciaPago = Math.floor(Date.now() / 1000) * 1000 + 500_000;
const nuevoPagoId = () => String((secuenciaPago += 1));
const siguiente = () => (contador += 1);

/** Nada que leer: nulo, falso o una estructura que por dentro no tiene ningún dato (`{ view: [], assigned: [] }`). */
const sinDatos = (valor: unknown): boolean => {
  if (valor === null || valor === undefined || valor === false) return true;
  if (Array.isArray(valor)) return valor.every(sinDatos);
  if (typeof valor === "object") return Object.values(valor).every(sinDatos);
  return false;
};

async function cuentaConfirmada(email?: string): Promise<string> {
  const creada = await service.auth.admin.createUser({ email: email ?? `reg-${sufijo}-${siguiente()}@example.test`, email_confirm: true });
  if (creada.error) throw new Error(creada.error.message);
  authIds.push(creada.data.user.id);
  return creada.data.user.id;
}

const alta = (userId: string, slug: string, version: string = TERMINOS) =>
  service.rpc("self_register_organization", {
    p_user: userId,
    p_slug: slug,
    p_name: `Local ${slug}`,
    p_branch_slug: "principal",
    p_branch_name: "Principal",
    p_terms_version: version,
  });

async function altaOk(userId: string, slug: string): Promise<string> {
  const r = await alta(userId, slug);
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  orgs.push(r.data as string);
  return r.data as string;
}

beforeAll(() => {
  service = serviceClient();
});

afterAll(async () => {
  for (const org of orgs) await deleteOrg(service, org);
  for (const user of users) await deleteUser(service, user);
  for (const id of authIds) await service.auth.admin.deleteUser(id);
  sql(`delete from public.trial_claims where claimed_at > now() - interval '1 hour'`);
});

describe("una cuenta sin local", () => {
  let sinLocal: TestUser;
  beforeAll(async () => {
    sinLocal = await createUser(service, "reg-sin-local");
    users.push(sinLocal);
  });

  it("no lee de ninguna tabla más que un visitante anónimo, salvo el catálogo de planes", async () => {
    const tablas = sql(`select tablename from pg_tables where schemaname = 'public' order by 1`).map((f) => f[0]);
    expect(tablas.length).toBeGreaterThan(20);
    const anon = anonClient();
    for (const tabla of tablas) {
      if (tabla === "plans" || tabla === "addons") continue;
      const [conSesion, sinSesion] = await Promise.all([
        sinLocal.db.from(tabla as "plans").select("*", { count: "exact", head: true }),
        anon.from(tabla as "plans").select("*", { count: "exact", head: true }),
      ]);
      expect(conSesion.count ?? 0, tabla).toBeLessThanOrEqual(sinSesion.count ?? 0);
    }
  });

  it("no se da un local ni se suma a uno por la API", async () => {
    const org = await sinLocal.db.from("organizations").insert({ slug: `tt-reg-api-${sufijo}`, name: "x" });
    expect(org.error).not.toBeNull();
    const member = await sinLocal.db.from("memberships").insert({ user_id: sinLocal.id, organization_id: ORG_CAFE, role: "owner" });
    expect(member.error).not.toBeNull();
    const sub = await sinLocal.db.from("subscriptions").update({ plan_code: "premium" }).eq("organization_id", ORG_CAFE).select("id");
    expect(sub.data ?? []).toEqual([]);
    const rpc = await sinLocal.db.rpc("self_register_organization", {
      p_user: sinLocal.id,
      p_slug: `tt-reg-rpc-${sufijo}`,
      p_name: "x",
      p_branch_slug: "principal",
      p_branch_name: "Principal",
      p_terms_version: TERMINOS,
    });
    expect(rpc.error?.code).toBe("42501");
  });

  it("no obtiene datos ni escribe con ninguna función disponible para `authenticated`", async () => {
    const funciones = sql(
      `select p.proname, pg_get_function_identity_arguments(p.oid)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
       order by 1`,
    );
    expect(funciones.length).toBeGreaterThan(20);

    const valor = (nombre: string, tipo: string): unknown => {
      if (tipo === "uuid") {
        if (nombre === "p_org") return ORG_CAFE;
        if (nombre === "p_branch") return BRANCH_CAFE;
        if (nombre === "p_product") return PRODUCT_ESPRESSO;
        return "99999999-0000-4000-8000-000000000001";
      }
      if (tipo.endsWith("[]")) return [];
      if (tipo === "integer" || tipo === "bigint") return 1;
      if (tipo === "boolean") return false;
      if (tipo === "jsonb") return {};
      if (tipo === "date") return "2030-01-01";
      if (tipo.startsWith("time without")) return "20:00";
      if (tipo.startsWith("timestamp")) return "2030-01-01T00:00:00Z";
      return "x";
    };

    const antes = sql(`select count(*) from public.reservations; select count(*) from public.orders; select count(*) from public.push_subscriptions`);
    for (const [nombre, firma] of funciones) {
      const args = Object.fromEntries(
        firma
          .split(", ")
          .filter(Boolean)
          .map((parte) => {
            const espacio = parte.indexOf(" ");
            const param = parte.slice(0, espacio);
            return [param, valor(param, parte.slice(espacio + 1).replace(/ default .*/i, ""))];
          }),
      );
      const { data, error } = await sinLocal.db.rpc(nombre as "owner_payment_quote", args as { p_org: string });
      expect(error !== null || sinDatos(data) || data === "unavailable", `${nombre} devolvió ${JSON.stringify(data)}`).toBe(true);
    }
    expect(sql(`select count(*) from public.reservations; select count(*) from public.orders; select count(*) from public.push_subscriptions`)).toEqual(antes);
  });
});

describe("confirmar el email", () => {
  const conClave = () => sql(`select 1`) && `reg-clave-${sufijo}-${siguiente()}@example.test`;
  const CLAVE_AJENA = "contrasena-del-intruso-1";
  const claveDe = (id: string) => sql(`select coalesce(encrypted_password, '') from auth.users where id = '${id}'`)[0]?.[0] ?? "";

  it("borra en esa misma escritura la contraseña cargada antes: nadie entra con ella", async () => {
    const email = conClave();
    const creada = await service.auth.admin.createUser({ email, password: CLAVE_AJENA });
    const id = creada.data.user!.id;
    authIds.push(id);
    expect(claveDe(id)).not.toBe("");

    sql(`update auth.users set email_confirmed_at = now() where id = '${id}'`);

    expect(claveDe(id)).toBe("");
    const intento = await anonClient().auth.signInWithPassword({ email, password: CLAVE_AJENA });
    expect(intento.error).not.toBeNull();
  });

  it("también la borra si la transacción escribió la fila antes de confirmar, como hace Auth al recuperar", async () => {
    const email = conClave();
    const creada = await service.auth.admin.createUser({ email, password: CLAVE_AJENA });
    const id = creada.data.user!.id;
    authIds.push(id);

    sql(`begin; update auth.users set recovery_token = '' where id = '${id}'; update auth.users set email_confirmed_at = now() where id = '${id}'; commit;`);

    expect(claveDe(id)).toBe("");
    expect((await anonClient().auth.signInWithPassword({ email, password: CLAVE_AJENA })).error).not.toBeNull();
  });

  it("una cuenta creada y confirmada en la misma operación conserva su contraseña", async () => {
    const email = conClave();
    const creada = await service.auth.admin.createUser({ email, password: CLAVE_AJENA, email_confirm: true });
    authIds.push(creada.data.user!.id);
    expect((await anonClient().auth.signInWithPassword({ email, password: CLAVE_AJENA })).error).toBeNull();
  });

  it("no toca una contraseña que llega en la misma escritura, ni la de una cuenta ya confirmada", async () => {
    const email = conClave();
    const creada = await service.auth.admin.createUser({ email, password: CLAVE_AJENA });
    const id = creada.data.user!.id;
    authIds.push(id);
    const nueva = await service.auth.admin.updateUserById(id, { password: "contrasena-del-titular-1", email_confirm: true });
    expect(nueva.error).toBeNull();
    expect((await anonClient().auth.signInWithPassword({ email, password: "contrasena-del-titular-1" })).error).toBeNull();

    const usuario = await createUser(service, "reg-ya-confirmada");
    users.push(usuario);
    const antes = claveDe(usuario.id);
    sql(`update auth.users set email_confirmed_at = now() where id = '${usuario.id}'`);
    expect(claveDe(usuario.id)).toBe(antes);
  });
});

describe("self_register_organization", () => {
  it("crea el local con Pro por 14 días, Dueño, sucursal, origen, reclamo y auditoría", async () => {
    const user = await cuentaConfirmada();
    const slug = `tt-reg-${sufijo}-a`;
    const orgId = await altaOk(user, slug);

    const org = (await service.from("organizations").select("slug, origin").eq("id", orgId).single()).data!;
    expect(org).toEqual({ slug, origin: "self_service" });
    const sub = (await service.from("subscriptions").select("plan_code, trial_ends_at, current_period_end").eq("organization_id", orgId).single()).data!;
    expect(sub.plan_code).toBe("pro");
    expect(sub.current_period_end).toBeNull();
    expect(Math.abs(new Date(sub.trial_ends_at!).getTime() - (Date.now() + 14 * DIA_MS))).toBeLessThan(60_000);
    const dueno = (await service.from("memberships").select("user_id, role").eq("organization_id", orgId)).data!;
    expect(dueno).toEqual([{ user_id: user, role: "owner" }]);
    const sucursales = (await service.from("branches").select("slug, is_active").eq("organization_id", orgId)).data!;
    expect(sucursales).toEqual([{ slug: "principal", is_active: true }]);
    const audit = (await service.from("audit_log").select("action, actor_id, after").eq("organization_id", orgId)).data!;
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("organization.self_registered");
    expect(audit[0].actor_id).toBe(user);
    expect((audit[0].after as { terms_version: string }).terms_version).toBe(TERMINOS);
  });

  it("rechaza una cuenta sin confirmar", async () => {
    const creada = await service.auth.admin.createUser({ email: `reg-sinconf-${sufijo}@example.test`, password: "contrasena-larga-123" });
    authIds.push(creada.data.user!.id);
    const r = await alta(creada.data.user!.id, `tt-reg-${sufijo}-sc`);
    expect(r.error?.code).toBe("42501");
    expect(r.error?.message).toContain("email_not_confirmed");
    const inexistente = await alta("99999999-0000-4000-8000-000000000002", `tt-reg-${sufijo}-ne`);
    expect(inexistente.error?.code).toBe("42501");
  });

  it("no da una segunda prueba a quien ya es Dueño", async () => {
    const user = await cuentaConfirmada();
    await altaOk(user, `tt-reg-${sufijo}-d1`);
    const r = await alta(user, `tt-reg-${sufijo}-d2`);
    expect(r.error?.message).toContain("already_owner");
  });

  it("recuerda el email aunque se borren la cuenta y el local, también con variantes del mismo buzón", async () => {
    const base = `reg.prueba.${sufijo}`.replace(/[^a-z0-9.]/g, "");
    const primera = await cuentaConfirmada(`${base}@gmail.com`);
    const orgId = await altaOk(primera, `tt-reg-${sufijo}-v1`);
    await deleteOrg(service, orgId);
    await service.auth.admin.deleteUser(primera);

    for (const [i, variante] of [`${base}@GMAIL.com`, `${base.replaceAll(".", "")}@gmail.com`, `${base}+promo@googlemail.com`].entries()) {
      const otra = await cuentaConfirmada(variante);
      const r = await alta(otra, `tt-reg-${sufijo}-v${i + 2}`);
      expect(r.error?.message, variante).toContain("trial_already_used");
      await service.auth.admin.deleteUser(otra);
    }
  });

  it("si la dirección está ocupada no deja nada a medias y se puede reintentar", async () => {
    const primero = await cuentaConfirmada();
    const slug = `tt-reg-${sufijo}-o`;
    await altaOk(primero, slug);
    const user = await cuentaConfirmada();
    const r = await alta(user, slug);
    expect(r.error?.code).toBe("23505");
    await altaOk(user, `${slug}2`);
  });

  it("rechaza direcciones reservadas y términos vacíos", async () => {
    const user = await cuentaConfirmada();
    expect((await alta(user, "admin")).error?.message).toContain("slug_reserved");
    expect((await alta(user, "UcoMenu")).error?.message).toContain("slug_reserved");
    expect((await alta(user, `tt-reg-${sufijo}-t`, "")).error?.message).toContain("invalid_terms");
  });

  it("con altas simultáneas no se pasa del tope: la segunda espera a la primera y la cuenta", async () => {
    const yaHay = Number(sql(`select count(*) from public.organizations where origin = 'self_service' and created_at > now() - interval '1 hour'`)[0][0]);
    const relleno = Array.from({ length: 29 - yaHay }, (_, i) => `tt-reg-tope-${sufijo}-${i}`);
    sql(`insert into public.organizations (slug, name, origin) values ${relleno.map((s) => `('${s}', '${s}', 'self_service')`).join(", ")}`);
    const [primera, segunda] = [await cuentaConfirmada(), await cuentaConfirmada()];
    const slugPrimera = `tt-reg-tope-${sufijo}-p`;
    try {
      // La primera alta queda abierta en otra conexión, sin confirmar: sin el candado, la segunda contaría 29 y también entraría.
      const abierta = spawn("docker", ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu", "psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "ignore", "pipe"] });
      const termino = new Promise<number>((resolve) => abierta.on("close", (code) => resolve(code ?? 1)));
      abierta.stdin.write(`begin;
select public.self_register_organization('${primera}', '${slugPrimera}', 'Primera', 'principal', 'Principal', '${TERMINOS}');
select pg_sleep(2);
commit;
`);
      abierta.stdin.end();
      await new Promise((resolve) => setTimeout(resolve, 700));

      const r = await alta(segunda, `tt-reg-tope-${sufijo}-s`);
      expect(await termino).toBe(0);
      if (typeof r.data === "string") orgs.push(r.data);
      expect(r.error?.message).toContain("signups_throttled");
    } finally {
      const creada = sql(`select id from public.organizations where slug = '${slugPrimera}'`)[0]?.[0];
      if (creada) await deleteOrg(service, creada);
      sql(`delete from public.organizations where slug like 'tt-reg-tope-${sufijo}-%'`);
    }
  });

  it("corta las altas si llega una ola", async () => {
    const slugs = Array.from({ length: 30 }, (_, i) => `tt-reg-ola-${sufijo}-${i}`);
    const valores = slugs.map((s) => `('${s}', '${s}', 'self_service')`).join(", ");
    sql(`insert into public.organizations (slug, name, origin) values ${valores}`);
    try {
      const user = await cuentaConfirmada();
      expect((await alta(user, `tt-reg-${sufijo}-ola`)).error?.message).toContain("signups_throttled");
    } finally {
      sql(`delete from public.organizations where slug like 'tt-reg-ola-${sufijo}-%'`);
    }
  });
});

describe("purge_unconfirmed_accounts", () => {
  const sinConfirmar = async (viejo: boolean) => {
    const creada = await service.auth.admin.createUser({ email: `reg-p-${sufijo}-${siguiente()}@example.test`, password: "contrasena-larga-123" });
    const id = creada.data.user!.id;
    authIds.push(id);
    if (viejo) sql(`update auth.users set created_at = now() - interval '8 days' where id = '${id}'`);
    return id;
  };
  const existe = (id: string) => sql(`select count(*) from auth.users where id = '${id}'`)[0][0] === "1";

  it("borra solo lo que corresponde", async () => {
    const vieja = await sinConfirmar(true);
    const reciente = await sinConfirmar(false);
    const conLocal = await sinConfirmar(true);
    const admin = await sinConfirmar(true);
    const reservada = await sinConfirmar(true);
    const confirmada = await cuentaConfirmada();
    sql(`update auth.users set created_at = now() - interval '30 days' where id = '${confirmada}'`);
    const orgId = await createOrg(service, `tt-reg-${sufijo}-p`, "pro");
    orgs.push(orgId);
    sql(`insert into public.memberships (user_id, organization_id, role) values ('${conLocal}', '${orgId}', 'staff')`);
    sql(`insert into public.platform_admins (user_id) values ('${admin}')`);
    sql(`insert into private.account_leases (user_id, purpose, expires_at) values ('${reservada}', 'account_delete', now() + interval '1 hour')`);

    try {
      const r = await service.rpc("purge_unconfirmed_accounts");
      expect(r.error, JSON.stringify(r.error)).toBeNull();
      expect(r.data).toBeGreaterThanOrEqual(1);
      expect(existe(vieja)).toBe(false);
      for (const id of [reciente, conLocal, admin, reservada, confirmada]) expect(existe(id), id).toBe(true);
    } finally {
      sql(`delete from public.platform_admins where user_id = '${admin}'`);
      sql(`delete from private.account_leases where user_id = '${reservada}'`);
    }
  });

  it("no acepta un plazo de menos de un día", async () => {
    const r = await service.rpc("purge_unconfirmed_accounts", { p_older_than: "1 hour" });
    expect(r.error?.message).toContain("invalid_retention");
  });

  it("la lista de cuentas sin local deja afuera a las sin confirmar", async () => {
    const admin = await createUser(service, "reg-admin");
    users.push(admin);
    sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
    try {
      const vieja = await sinConfirmar(true);
      const r = await service.rpc("admin_list_orphan_accounts", { p_actor: admin.id });
      expect(r.error).toBeNull();
      expect((r.data as { user_id: string }[]).map((c) => c.user_id)).not.toContain(vieja);
    } finally {
      sql(`delete from public.platform_admins where user_id = '${admin.id}'`);
    }
  });
});

describe("plan elegido al pagar", () => {
  type Quote = { available: boolean; reason?: string; options: { plan_code: string; billing_cycle: string; available: boolean; reason: string | null; limit: string | null; amount_cents: number | null }[] };

  async function local(opciones: { trial?: boolean; plan?: "basic" | "pro" | "premium" } = {}) {
    const n = siguiente();
    const id = await createOrg(service, `tt-reg-cobro-${sufijo}-${n}`, opciones.plan ?? "pro");
    orgs.push(id);
    const owner = await createUser(service, `reg-cobro-${n}`);
    users.push(owner);
    await addMembership(service, owner, id, "owner");
    const trial = opciones.trial ?? true;
    const fin = new Date(Date.now() + 5 * DIA_MS).toISOString();
    const r = await service.from("subscriptions").update(trial ? { trial_ends_at: fin, current_period_end: null } : { trial_ends_at: null, current_period_end: fin }).eq("organization_id", id);
    if (r.error) throw new Error(r.error.message);
    return { id, owner };
  }
  const pedir = (l: { id: string; owner: TestUser }, plan?: string, cycle?: string) =>
    service.rpc("system_start_payment_intent", { p_org: l.id, p_user: l.owner.id, ...(plan ? { p_plan: plan, p_cycle: cycle } : {}) });
  const registrar = (intentId: string, pagoId: string, amount: number) =>
    service.rpc("system_register_mp_payment", { p_intent: intentId, p_provider_payment_id: pagoId, p_amount_cents: amount, p_currency: "ARS", p_paid_at: new Date().toISOString() });
  const sub = async (id: string) => (await service.from("subscriptions").select("plan_code, billing_cycle, current_period_end").eq("organization_id", id).single()).data!;
  const precio = (plan: string, ciclo: "monthly_price_cents" | "yearly_price_cents") => Number(sql(`select ${ciclo} from public.plans where code = '${plan}'`)[0][0]);

  it("en prueba ofrece Básico y Pro, por mes y por año, con el precio de la base", async () => {
    const l = await local();
    const { data } = await l.owner.db.rpc("owner_payment_quote", { p_org: l.id });
    const quote = data as Quote;
    const disponibles = quote.options.filter((o) => o.available).map((o) => `${o.plan_code}:${o.billing_cycle}`);
    expect(disponibles.sort()).toEqual(["basic:monthly", "basic:yearly", "pro:monthly", "pro:yearly"]);
    expect(quote.options.find((o) => o.plan_code === "basic" && o.billing_cycle === "yearly")?.amount_cents).toBe(precio("basic", "yearly_price_cents"));
    expect(quote.options.some((o) => o.plan_code === "premium")).toBe(false);
  });

  it("el plan cambia recién al registrar el pago, en la misma operación y con auditoría", async () => {
    const l = await local();
    const pedido = await pedir(l, "basic", "yearly");
    expect(pedido.error, JSON.stringify(pedido.error)).toBeNull();
    const intent = pedido.data as { intent_id: string; amount_cents: number };
    expect(intent.amount_cents).toBe(precio("basic", "yearly_price_cents"));
    expect((await sub(l.id)).plan_code).toBe("pro");

    const r = await registrar(intent.intent_id, nuevoPagoId(), intent.amount_cents);
    expect((r.data as { result: string }).result).toBe("registered");
    const despues = await sub(l.id);
    expect(despues.plan_code).toBe("basic");
    expect(despues.billing_cycle).toBe("yearly");
    expect(new Date(despues.current_period_end!).getTime()).toBeGreaterThan(Date.now() + 360 * DIA_MS);

    const acciones = (await service.from("audit_log").select("action, before, after").eq("organization_id", l.id).order("created_at")).data!;
    const cambio = acciones.find((a) => a.action === "subscription.plan_changed")!;
    expect((cambio.before as { plan: string }).plan).toBe("pro");
    expect((cambio.after as { plan: string }).plan).toBe("basic");
    expect(acciones.some((a) => a.action === "payment.registered")).toBe(true);
    const pago = (await service.from("payments").select("plan_code, billing_cycle").eq("organization_id", l.id).single()).data!;
    expect(pago).toEqual({ plan_code: "basic", billing_cycle: "yearly" });
  });

  it("con un período pago vigente solo se renueva el mismo plan", async () => {
    const l = await local({ trial: false, plan: "basic" });
    const distinto = await pedir(l, "pro", "monthly");
    expect(distinto.error?.message).toContain("paid_period_active");
    const ciclo = await pedir(l, "basic", "yearly");
    expect(ciclo.error?.message).toContain("paid_period_active");
    const mismo = await pedir(l);
    expect(mismo.error).toBeNull();
    expect((mismo.data as { plan_code: string }).plan_code).toBe("basic");
  });

  it("no acepta planes sin precio, ciclos inventados ni locales que no entran en el plan", async () => {
    const l = await local();
    expect((await pedir(l, "premium", "monthly")).error?.message).toContain("no_list_price");
    expect((await pedir(l, "inventado", "monthly")).error?.message).toContain("no_list_price");
    expect((await pedir(l, "basic", "semanal")).error?.message).toContain("invalid_choice");

    const b = await service.from("branches").insert([
      { organization_id: l.id, slug: "uno", name: "Uno" },
      { organization_id: l.id, slug: "dos", name: "Dos" },
    ]);
    expect(b.error).toBeNull();
    expect((await pedir(l, "basic", "monthly")).error?.message).toContain("over_plan_limit");
    const { data } = await l.owner.db.rpc("owner_payment_quote", { p_org: l.id });
    const basico = (data as Quote).options.find((o) => o.plan_code === "basic" && o.billing_cycle === "monthly")!;
    expect(basico.available).toBe(false);
    expect(basico.limit).toBe("branches");
  });

  it("si el local deja de entrar antes del pago, va a revisar y no cambia nada", async () => {
    const l = await local();
    const intent = (await pedir(l, "basic", "monthly")).data as { intent_id: string; amount_cents: number };
    const b = await service.from("branches").insert([
      { organization_id: l.id, slug: "uno", name: "Uno" },
      { organization_id: l.id, slug: "dos", name: "Dos" },
    ]);
    expect(b.error).toBeNull();
    const antes = await sub(l.id);
    const r = await registrar(intent.intent_id, nuevoPagoId(), intent.amount_cents);
    expect(r.data).toMatchObject({ result: "review", reason: "over_plan_limit" });
    expect(await sub(l.id)).toEqual(antes);
  });

  it("un plato que se está creando mientras se acredita Básico se cuenta: va a revisar", async () => {
    const l = await local();
    const tope = Number(sql(`select max_active_products from public.plans where code = 'basic'`)[0][0]);
    const categoria = sql(`insert into public.categories (organization_id, name) values ('${l.id}', 'Cat') returning id`)[0][0];
    sql(`insert into public.products (organization_id, category_id, name, price_cents, is_active)
         select '${l.id}', '${categoria}', 'Plato ' || g, 100, true from generate_series(1, ${tope}) g`);
    const intent = (await pedir(l, "basic", "monthly")).data as { intent_id: string; amount_cents: number };
    expect(intent.intent_id).toBeTruthy();

    // Otra conexión con el alta abierta: tiene el candado del trigger y todavía no confirmó.
    const alta = spawn("docker", ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu", "psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "ignore", "pipe"] });
    const termino = new Promise<number>((resolve) => alta.on("close", (code) => resolve(code ?? 1)));
    alta.stdin.write(`begin;
insert into public.products (organization_id, category_id, name, price_cents, is_active) values ('${l.id}', '${categoria}', 'De más', 100, true);
select pg_sleep(2);
commit;
`);
    alta.stdin.end();
    await new Promise((resolve) => setTimeout(resolve, 700));

    const r = await registrar(intent.intent_id, nuevoPagoId(), intent.amount_cents);
    expect(await termino).toBe(0);
    expect(r.data).toMatchObject({ result: "review", reason: "over_plan_limit" });
    expect((await sub(l.id)).plan_code).toBe("pro");
  });

  it("si el SuperAdmin cambió el plan con el link abierto, va a revisar", async () => {
    const l = await local();
    const intent = (await pedir(l, "basic", "monthly")).data as { intent_id: string; amount_cents: number };
    await service.from("subscriptions").update({ plan_code: "premium" }).eq("organization_id", l.id);
    const r = await registrar(intent.intent_id, nuevoPagoId(), intent.amount_cents);
    expect(r.data).toMatchObject({ result: "review", reason: "plan_changed" });
    expect((await sub(l.id)).plan_code).toBe("premium");
  });

  it("un link viejo de otro plan no cambia nada si ya se pagó un período", async () => {
    const l = await local();
    const viejo = (await pedir(l, "basic", "monthly")).data as { intent_id: string; amount_cents: number };
    const nuevo = (await pedir(l, "pro", "monthly")).data as { intent_id: string; amount_cents: number };
    expect((await registrar(nuevo.intent_id, nuevoPagoId(), nuevo.amount_cents)).data).toMatchObject({ result: "registered" });
    const antes = await sub(l.id);
    const r = await registrar(viejo.intent_id, nuevoPagoId(), viejo.amount_cents);
    expect(r.data).toMatchObject({ result: "review", reason: "plan_changed" });
    expect(await sub(l.id)).toEqual(antes);
  });

  it("nadie pide un link por la API", async () => {
    const l = await local();
    const r = await l.owner.db.rpc("system_start_payment_intent", { p_org: l.id, p_user: l.owner.id, p_plan: "basic", p_cycle: "monthly" });
    expect(r.error?.code).toBe("42501");
  });
});
