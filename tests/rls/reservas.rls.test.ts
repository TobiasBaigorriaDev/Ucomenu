import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, anonClient, createOrg, createUser, DIA_MS, deleteOrg, deleteUser, serviceClient, setSubscription, sql, type Db, type PlanCode, type TestUser } from "./helpers";

/**
 * Reservas de mesa, fase 1 (nivel C, ficha reservas-de-mesa, ADR 0051) contra el Supabase local: quién gestiona (rol, plan y mora), que
 * nadie escribe la tabla por la API, la hora local de la sucursal, el reintento seguro con `client_key`, que una mesa no tiene dos
 * reservas superpuestas, las transiciones de estado, el aislamiento entre organizaciones y la purga a los 30 días.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let cook: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const MADRID = "Europe/Madrid";

type Local = { id: string; branch: string; table: string; table2: string };

async function nuevoLocal(plan: PlanCode = "pro", opciones: { miembros?: boolean; tz?: string } = {}): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-res-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal: ${b.error.message}`);
  if (opciones.tz) sql(`update public.branches set timezone = '${opciones.tz}' where id = '${b.data.id}'`);
  const mesas = await service
    .from("tables")
    .insert([
      { organization_id: id, branch_id: b.data.id, label: "Mesa 1" },
      { organization_id: id, branch_id: b.data.id, label: "Mesa 2" },
    ])
    .select("id, label")
    .order("label");
  if (mesas.error) throw new Error(`mesas: ${mesas.error.message}`);
  if (opciones.miembros !== false) {
    await addMembership(service, owner, id, "owner");
    await addMembership(service, staff, id, "staff");
    await addMembership(service, cook, id, "cook");
  }
  return { id, branch: b.data.id, table: mesas.data[0].id, table2: mesas.data[1].id };
}

/** Fecha y hora LOCALES de `tz` dentro de `minutos` (negativo: pasado). */
function local(tz: string, minutos: number): { date: string; time: string } {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(Date.now() + minutos * 60_000))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${partes.year}-${partes.month}-${partes.day}`, time: `${partes.hour}:${partes.minute}` };
}

type Args = Partial<{
  p_branch: string;
  p_name: string | null;
  p_phone: string | null;
  p_email: string | null;
  p_party: number | null;
  p_date: string | null;
  p_time: string | null;
  p_duration: number | null;
  p_notes: string | null;
  p_table: string | null;
  p_client_key: string | null;
}>;

const BA = "America/Argentina/Buenos_Aires";

/** Una reserva dentro de `minutos` (en la hora local de la sucursal). */
const reservar = (db: Db, l: Local, minutos = 24 * 60, extra: Args = {}, tz = BA) => {
  const { date, time } = local(tz, minutos);
  return db.rpc("create_reservation", {
    p_branch: l.branch,
    p_name: "Ana Pérez",
    p_phone: "+54 11 5555-1234",
    p_email: null,
    p_party: 4,
    p_date: date,
    p_time: time,
    p_duration: 90,
    p_notes: null,
    p_table: null,
    p_client_key: randomUUID(),
    ...extra,
  } as never);
};

type Resultado = { id: string; status: string; starts_at: string; table_label: string | null; replayed?: boolean };
const ok = (r: { data: unknown; error: { message: string } | null }): Resultado => {
  if (r.error) throw new Error(`rpc: ${r.error.message}`);
  return r.data as Resultado;
};

const cuenta = (orgId: string) => Number(sql(`select count(*) from public.reservations where organization_id = '${orgId}'`)[0][0]);
const estado = (id: string) => sql(`select status, coalesce(table_label, ''), coalesce(table_id::text, '') from public.reservations where id = '${id}'`)[0];


/**
 * Otra sesión de la base retiene un candado de aviso `segundos` y la devuelve junto con una promesa de su fin. Sirve para detener una
 * función justo donde espera ese candado y comprobar DOS cosas: que de verdad lo toma (si no lo tomara, no quedaría esperando) y que lo
 * que cambió mientras esperaba cuenta al despertar. Es lo que hace que estas pruebas FALLEN si se quita el candado (revisión de Codex).
 */
function retenerCandado(clave: string, segundos: number) {
  const proceso = spawn("docker", ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", `begin; select pg_advisory_xact_lock(${clave}); select pg_sleep(${segundos}); commit;`], { stdio: "ignore" });
  return new Promise<void>((resolver) => proceso.on("exit", () => resolver()));
}
const esperando = (funcion: string) =>
  Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%${funcion}%' and query not like '%pg_stat_activity%'`)[0][0]);
const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, cook, stranger] = await Promise.all([
    createUser(service, "res-owner"),
    createUser(service, "res-staff"),
    createUser(service, "res-cook"),
    createUser(service, "res-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, cook, stranger].map((u) => deleteUser(service, u)));
});

describe("el catálogo", () => {
  it("reservations está en Pro y Premium y no en Básico, y org_entitlements la informa solo donde rige", async () => {
    const planes = await service.from("plans").select("code, features").order("code");
    const porCodigo = Object.fromEntries((planes.data ?? []).map((p) => [p.code, p.features]));
    expect(porCodigo.basic).not.toContain("reservations");
    expect(porCodigo.pro).toContain("reservations");
    expect(porCodigo.premium).toContain("reservations");

    const pro = await nuevoLocal("pro");
    const basico = await nuevoLocal("basic");
    const con = await owner.db.rpc("org_entitlements", { p_org: pro.id });
    const sin = await owner.db.rpc("org_entitlements", { p_org: basico.id });
    expect((con.data as { features: string[] }).features).toContain("reservations");
    expect((sin.data as { features: string[] }).features).not.toContain("reservations");
  });
});

describe("quién gestiona reservas", () => {
  it("el Dueño y el Staff de un local Pro crean una reserva solicitada; nacen manuales", async () => {
    const l = await nuevoLocal();
    for (const u of [owner, staff]) {
      const r = ok(await reservar(u.db, l));
      expect(r.status).toBe("requested");
      expect(r.replayed).toBe(false);
    }
    expect(cuenta(l.id)).toBe(2);
    expect(sql(`select distinct source from public.reservations where organization_id = '${l.id}'`)).toEqual([["manual"]]);
  });

  it("el cocinero, un miembro de otro local y un anónimo no crean nada", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal("pro", { miembros: false });
    await addMembership(service, stranger, otro.id, "owner");
    for (const db of [cook.db, stranger.db]) {
      const r = await reservar(db, l);
      expect(r.error?.message).toBe("reservations_not_allowed");
    }
    const anon = await reservar(anonClient(), l);
    expect(anon.error).not.toBeNull();
    expect(cuenta(l.id)).toBe(0);
    expect(cuenta(otro.id)).toBe(0);
  });

  it("sin la función en el plan (Básico) no se crea ni se cambia nada", async () => {
    const l = await nuevoLocal("basic");
    expect((await reservar(owner.db, l)).error?.message).toBe("reservations_not_allowed");
    expect(cuenta(l.id)).toBe(0);
  });

  it("en gracia sí; en solo lectura y suspendida no, y sigue pudiéndose leer lo ya cargado", async () => {
    const l = await nuevoLocal();
    const id = ok(await reservar(owner.db, l)).id;
    await setSubscription(service, l.id, { finEnMs: -3 * DIA_MS }); // gracia
    ok(await reservar(owner.db, l));
    for (const dias of [10, 20]) {
      await setSubscription(service, l.id, { finEnMs: -dias * DIA_MS }); // solo lectura, suspendida
      expect((await reservar(owner.db, l)).error?.message).toBe("reservations_not_allowed");
      expect((await owner.db.rpc("set_reservation_status", { p_reservation: id, p_status: "cancelled" })).error?.message).toBe("reservations_not_allowed");
      expect((await owner.db.rpc("assign_reservation_table", { p_reservation: id, p_table: l.table })).error?.message).toBe("reservations_not_allowed");
      const lectura = await owner.db.from("reservations").select("id").eq("id", id);
      expect(lectura.data).toHaveLength(1);
    }
    expect(estado(id)[0]).toBe("requested");
  });
});

describe("quién lee reservas", () => {
  it("lo leen el Dueño y el Staff de ese local; no el cocinero, otro local ni un anónimo", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal("pro", { miembros: false });
    await addMembership(service, stranger, otro.id, "owner");
    const id = ok(await reservar(owner.db, l)).id;
    for (const u of [owner, staff]) expect((await u.db.from("reservations").select("id").eq("id", id)).data).toHaveLength(1);
    for (const db of [cook.db, stranger.db, anonClient()]) {
      const r = await db.from("reservations").select("id").eq("id", id);
      expect(r.data ?? []).toHaveLength(0);
    }
  });

  it("nadie escribe la tabla por la API: ni Dueño, ni Staff, ni el servicio técnico", async () => {
    const l = await nuevoLocal();
    const id = ok(await reservar(owner.db, l)).id;
    const fila = { organization_id: l.id, branch_id: l.branch, guest_name: "X", guest_phone: "123456", party_size: 2, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600_000).toISOString(), client_key: randomUUID(), request_hash: "x" };
    for (const db of [owner.db, staff.db, service]) {
      expect((await db.from("reservations").insert(fila)).error).not.toBeNull();
      expect((await db.from("reservations").update({ guest_name: "Otro" }).eq("id", id)).error).not.toBeNull();
      expect((await db.from("reservations").delete().eq("id", id)).error).not.toBeNull();
    }
    expect(cuenta(l.id)).toBe(1);
    expect(sql(`select guest_name from public.reservations where id = '${id}'`)[0][0]).toBe("Ana Pérez");
  });

  it("las funciones de escritura no son del anónimo ni del servicio técnico", async () => {
    const l = await nuevoLocal();
    const id = ok(await reservar(owner.db, l)).id;
    expect((await anonClient().rpc("set_reservation_status", { p_reservation: id, p_status: "cancelled" })).error).not.toBeNull();
    expect((await service.rpc("set_reservation_status", { p_reservation: id, p_status: "cancelled" })).error).not.toBeNull();
    expect((await service.rpc("assign_reservation_table", { p_reservation: id, p_table: l.table })).error).not.toBeNull();
    expect(estado(id)[0]).toBe("requested");
  });
});

describe("los datos de la reserva", () => {
  it("rechaza lo inválido con errores estables y no crea nada", async () => {
    const l = await nuevoLocal();
    const casos: [Args, string][] = [
      [{ p_name: "   " }, "invalid_name"],
      [{ p_name: "x".repeat(81) }, "invalid_name"],
      [{ p_phone: "abc" }, "invalid_phone"],
      [{ p_phone: "12 34" }, "invalid_phone"],
      [{ p_phone: "(((((())))))" }, "invalid_phone"],
      [{ p_email: "sin-arroba" }, "invalid_email"],
      [{ p_email: `${"a".repeat(120)}@x.com` }, "invalid_email"],
      [{ p_party: 0 }, "invalid_party"],
      [{ p_party: 51 }, "invalid_party"],
      [{ p_party: null }, "invalid_party"],
      [{ p_duration: 10 }, "invalid_duration"],
      [{ p_duration: 400 }, "invalid_duration"],
      [{ p_notes: "x".repeat(301) }, "invalid_notes"],
      [{ p_notes: "con\tcontrol" }, "invalid_notes"],
      [{ p_date: null }, "invalid_time"],
      [{ p_time: null }, "invalid_time"],
      [{ p_client_key: null }, "invalid_client_key"],
    ];
    for (const [extra, error] of casos) {
      const r = await reservar(owner.db, l, 24 * 60, extra);
      expect(r.error?.message, JSON.stringify(extra)).toBe(error);
    }
    // Pasado (más de 1 hora) y más de un año adelante.
    expect((await reservar(owner.db, l, -3 * 60)).error?.message).toBe("invalid_time");
    expect((await reservar(owner.db, l, 366 * 24 * 60)).error?.message).toBe("invalid_time");
    // Dentro de la hora de margen sí.
    ok(await reservar(owner.db, l, -30));
    expect(cuenta(l.id)).toBe(1);
  });

  it("la fecha y la hora son las de la sucursal: 21:00 en Madrid no es 21:00 en Buenos Aires", async () => {
    const madrid = await nuevoLocal("pro", { tz: MADRID });
    const { date } = local(MADRID, 3 * 24 * 60);
    const r = ok(await reservar(owner.db, madrid, 0, { p_date: date, p_time: "21:00" }, MADRID));
    expect(sql(`select to_char(starts_at at time zone '${MADRID}', 'YYYY-MM-DD HH24:MI') from public.reservations where id = '${r.id}'`)[0][0]).toBe(`${date} 21:00`);
    expect(sql(`select to_char(starts_at at time zone '${BA}', 'HH24:MI') from public.reservations where id = '${r.id}'`)[0][0]).not.toBe("21:00");
  });

  it("repetir el envío con la misma clave devuelve la misma reserva; con otros datos, se rechaza", async () => {
    const l = await nuevoLocal();
    const clave = randomUUID();
    const a = ok(await reservar(owner.db, l, 24 * 60, { p_client_key: clave }));
    const b = ok(await reservar(owner.db, l, 24 * 60, { p_client_key: clave }));
    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);
    expect((await reservar(owner.db, l, 24 * 60, { p_client_key: clave, p_party: 5 })).error?.message).toBe("client_key_reused");
    // Tampoco una nota distinta se toma por un reintento (revisión de Codex, ronda 1): la persona creería que quedó registrada.
    const conNota = randomUUID();
    ok(await reservar(owner.db, l, 24 * 60, { p_client_key: conNota, p_notes: "sin gluten" }));
    expect((await reservar(owner.db, l, 24 * 60, { p_client_key: conNota, p_notes: "cumpleaños" })).error?.message).toBe("client_key_reused");
    expect((await reservar(owner.db, l, 24 * 60, { p_client_key: conNota, p_notes: null })).error?.message).toBe("client_key_reused");
    expect(ok(await reservar(owner.db, l, 24 * 60, { p_client_key: conNota, p_notes: "sin gluten" })).replayed).toBe(true);
    expect(cuenta(l.id)).toBe(2);
  });

  it("envíos simultáneos con la misma clave crean una sola reserva", async () => {
    const l = await nuevoLocal();
    const clave = randomUUID();
    const rs = await Promise.all(Array.from({ length: 6 }, () => reservar(owner.db, l, 24 * 60, { p_client_key: clave })));
    expect(rs.every((r) => r.error === null)).toBe(true);
    expect(new Set(rs.map((r) => ok(r).id)).size).toBe(1);
    expect(cuenta(l.id)).toBe(1);
  });
});

describe("la clave del envío", () => {
  it("el alta espera el candado de su clave: el reintento no cruza la puerta si mientras tanto perdió el permiso", async () => {
    const l = await nuevoLocal();
    const clave = randomUUID();
    ok(await reservar(staff.db, l, 24 * 60, { p_client_key: clave }));
    const termino = retenerCandado(`hashtextextended('${l.id}' || '${clave}', 0)`, 4);
    await pausa(2000);
    const espera = reservar(staff.db, l, 24 * 60, { p_client_key: clave }).then((x) => x);
    await pausa(800);
    expect(esperando("create_reservation")).toBeGreaterThanOrEqual(1);
    expect((await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", staff.id)).error).toBeNull();
    const r = await espera;
    expect(r.error?.message).toBe("reservations_not_allowed");
    expect(r.data).toBeNull();
    await termino;
    expect(cuenta(l.id)).toBe(1);
    await addMembership(service, staff, l.id, "staff");
  });
});

describe("la mesa", () => {
  it("con mesa la reserva nace confirmada y copia su etiqueta; asignar una mesa a una solicitada la confirma", async () => {
    const l = await nuevoLocal();
    const directa = ok(await reservar(owner.db, l, 24 * 60, { p_table: l.table }));
    expect(directa.status).toBe("confirmed");
    expect(directa.table_label).toBe("Mesa 1");
    const sola = ok(await reservar(owner.db, l, 48 * 60));
    expect(sola.status).toBe("requested");
    const asignada = (await staff.db.rpc("assign_reservation_table", { p_reservation: sola.id, p_table: l.table2 })).data as Resultado;
    expect(asignada.status).toBe("confirmed");
    expect(asignada.table_label).toBe("Mesa 2");
  });

  it("una mesa no tiene dos reservas confirmadas superpuestas, pero sí una pegada a la otra", async () => {
    const l = await nuevoLocal();
    const { date, time } = local(BA, 24 * 60);
    const base = { p_date: date, p_time: time, p_duration: 90 };
    ok(await reservar(owner.db, l, 0, { ...base, p_table: l.table }));
    // Mismo horario y horario que se pisa: se rechaza y no queda nada.
    expect((await reservar(owner.db, l, 0, { ...base, p_table: l.table })).error?.code).toBe("23P01");
    const otraHora = local(BA, 24 * 60 + 60);
    expect((await reservar(owner.db, l, 0, { ...base, p_date: otraHora.date, p_time: otraHora.time, p_table: l.table })).error?.message).toBe("table_busy");
    expect(cuenta(l.id)).toBe(1);
    // Justo cuando termina la primera (90 minutos después), la mesa está libre; y la otra mesa, siempre.
    const despues = local(BA, 24 * 60 + 90);
    ok(await reservar(owner.db, l, 0, { ...base, p_date: despues.date, p_time: despues.time, p_table: l.table }));
    ok(await reservar(owner.db, l, 0, { ...base, p_table: l.table2 }));
    expect(cuenta(l.id)).toBe(3);
  });

  it("asignar la misma mesa a dos reservas a la vez deja solo una", async () => {
    const l = await nuevoLocal();
    const { date, time } = local(BA, 24 * 60);
    const a = ok(await reservar(owner.db, l, 0, { p_date: date, p_time: time }));
    const b = ok(await reservar(owner.db, l, 0, { p_date: date, p_time: time }));
    const rs = await Promise.all([
      owner.db.rpc("assign_reservation_table", { p_reservation: a.id, p_table: l.table }),
      staff.db.rpc("assign_reservation_table", { p_reservation: b.id, p_table: l.table }),
    ]);
    expect(rs.filter((r) => r.error === null)).toHaveLength(1);
    expect(rs.filter((r) => r.error?.message === "table_busy")).toHaveLength(1);
    expect(sql(`select count(*) from public.reservations where table_id = '${l.table}' and status = 'confirmed'`)[0][0]).toBe("1");
  });

  it("asignar espera el candado de la mesa, y lo que otra sesión confirmó mientras tanto cuenta al despertar", async () => {
    const l = await nuevoLocal();
    const { date, time } = local(BA, 24 * 60);
    const r = ok(await reservar(owner.db, l, 0, { p_date: date, p_time: time }));
    const termino = retenerCandado(`hashtextextended('${l.table}', 1)`, 4);
    await pausa(2000);
    // `.then` fuerza el envío: el cliente no manda la llamada hasta que alguien la espera.
    const espera = owner.db.rpc("assign_reservation_table", { p_reservation: r.id, p_table: l.table }).then((x) => x);
    await pausa(800);
    // Tiene que estar de verdad detenida en el candado de ESA mesa (sin el candado, no esperaría).
    expect(esperando("assign_reservation_table")).toBeGreaterThanOrEqual(1);
    // Mientras tanto, otra reserva queda confirmada en esa mesa y en ese horario.
    sql(
      `insert into public.reservations (organization_id, branch_id, table_id, table_label, status, guest_name, guest_phone, party_size, starts_at, ends_at, client_key, request_hash) ` +
        `select organization_id, branch_id, '${l.table}', 'Mesa 1', 'confirmed', 'Ocupante', '123456', 2, starts_at, ends_at, gen_random_uuid(), 'x' from public.reservations where id = '${r.id}'`,
    );
    expect((await espera).error?.message).toBe("table_busy");
    await termino;
    expect(estado(r.id)[0]).toBe("requested");
  });

  it("también revalida quién llama después de esperar el candado de la mesa", async () => {
    const l = await nuevoLocal();
    const r = ok(await reservar(owner.db, l));
    const termino = retenerCandado(`hashtextextended('${l.table}', 1)`, 4);
    await pausa(2000);
    const espera = staff.db.rpc("assign_reservation_table", { p_reservation: r.id, p_table: l.table }).then((x) => x);
    await pausa(800);
    expect(esperando("assign_reservation_table")).toBeGreaterThanOrEqual(1);
    expect((await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", staff.id)).error).toBeNull();
    expect((await espera).error?.message).toBe("reservations_not_allowed");
    await termino;
    expect(estado(r.id)[0]).toBe("requested");
    await addMembership(service, staff, l.id, "staff");
  });

  it("una reserva cancelada o rechazada libera la mesa", async () => {
    const l = await nuevoLocal();
    const { date, time } = local(BA, 24 * 60);
    const a = ok(await reservar(owner.db, l, 0, { p_date: date, p_time: time, p_table: l.table }));
    expect((await reservar(owner.db, l, 0, { p_date: date, p_time: time, p_table: l.table })).error?.message).toBe("table_busy");
    ok(await owner.db.rpc("set_reservation_status", { p_reservation: a.id, p_status: "cancelled" }));
    ok(await reservar(owner.db, l, 0, { p_date: date, p_time: time, p_table: l.table }));
  });

  it("una mesa de otra sucursal u organización, o dada de baja, no se puede asignar", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal("pro", { miembros: false });
    const r = ok(await reservar(owner.db, l));
    expect((await owner.db.rpc("assign_reservation_table", { p_reservation: r.id, p_table: otro.table })).error?.message).toBe("table_not_found");
    expect((await reservar(owner.db, l, 24 * 60, { p_table: otro.table })).error?.message).toBe("table_not_found");
    sql(`update public.tables set is_active = false where id = '${l.table2}'`);
    expect((await owner.db.rpc("assign_reservation_table", { p_reservation: r.id, p_table: l.table2 })).error?.message).toBe("table_not_found");
    expect(estado(r.id)[0]).toBe("requested");
  });

  it("borrar la mesa deja la reserva confirmada con su etiqueta y sin mesa; borrar la organización se lleva las reservas", async () => {
    const l = await nuevoLocal();
    const r = ok(await reservar(owner.db, l, 24 * 60, { p_table: l.table }));
    sql(`delete from public.tables where id = '${l.table}'`);
    expect(estado(r.id)).toEqual(["confirmed", "Mesa 1", ""]);
    await deleteOrg(service, l.id);
    orgs.splice(orgs.indexOf(l.id), 1);
    expect(cuenta(l.id)).toBe(0);
  });

  it("ninguna fila apunta a una sucursal o mesa de otra organización (claves compuestas)", async () => {
    const a = await nuevoLocal();
    const b = await nuevoLocal("pro", { miembros: false });
    const fila = (branch: string, table: string | null) =>
      `insert into public.reservations (organization_id, branch_id, table_id, table_label, status, guest_name, guest_phone, party_size, starts_at, ends_at, client_key, request_hash) values ` +
      `('${a.id}', '${branch}', ${table ? `'${table}'` : "null"}, ${table ? "'x'" : "null"}, ${table ? "'confirmed'" : "'requested'"}, 'X', '123456', 2, now() + interval '1 day', now() + interval '1 day 1 hour', gen_random_uuid(), 'x')`;
    expect(() => sql(fila(b.branch, null))).toThrow();
    expect(() => sql(fila(a.branch, b.table))).toThrow();
    expect(cuenta(a.id)).toBe(0);
  });
});

describe("los estados", () => {
  it("requested → cancelled / rejected; confirmed → seated / cancelled / no_show / requested; lo demás no", async () => {
    const l = await nuevoLocal();
    const cambiar = (id: string, p_status: string) => owner.db.rpc("set_reservation_status", { p_reservation: id, p_status });

    const a = ok(await reservar(owner.db, l));
    expect((await cambiar(a.id, "seated")).error?.message).toBe("invalid_transition");
    expect((await cambiar(a.id, "no_show")).error?.message).toBe("invalid_transition");
    expect((await cambiar(a.id, "confirmed")).error?.message).toBe("invalid_status");
    expect((await cambiar(a.id, "nada")).error?.message).toBe("invalid_status");
    ok(await cambiar(a.id, "rejected"));
    for (const destino of ["requested", "cancelled", "seated", "rejected", "no_show"]) {
      expect((await cambiar(a.id, destino)).error?.message, `rejected → ${destino}`).toBe("invalid_transition");
    }

    const b = ok(await reservar(owner.db, l, 24 * 60, { p_table: l.table }));
    ok(await cambiar(b.id, "requested"));
    expect(estado(b.id)).toEqual(["requested", "", ""]);
    // Cancelar suelta la mesa pero deja su etiqueta como constancia.
    const c = ok(await reservar(owner.db, l, 48 * 60, { p_table: l.table2 }));
    ok(await cambiar(c.id, "cancelled"));
    expect(estado(c.id)).toEqual(["cancelled", "Mesa 2", ""]);
    await owner.db.rpc("assign_reservation_table", { p_reservation: b.id, p_table: l.table });
    ok(await cambiar(b.id, "seated"));
    for (const destino of ["requested", "cancelled", "no_show", "seated"]) {
      expect((await cambiar(b.id, destino)).error?.message, `seated → ${destino}`).toBe("invalid_transition");
    }
    expect((await owner.db.rpc("assign_reservation_table", { p_reservation: b.id, p_table: l.table2 })).error?.message).toBe("invalid_transition");
  });

  it("«no vino» solo desde la hora de inicio", async () => {
    const l = await nuevoLocal();
    const futura = ok(await reservar(owner.db, l, 24 * 60, { p_table: l.table }));
    expect((await owner.db.rpc("set_reservation_status", { p_reservation: futura.id, p_status: "no_show" })).error?.message).toBe("invalid_transition");
    // Empezó hace 30 minutos (dentro del margen de alta).
    const ya = ok(await reservar(owner.db, l, -30, { p_table: l.table2 }));
    ok(await owner.db.rpc("set_reservation_status", { p_reservation: ya.id, p_status: "no_show" }));
    expect(estado(ya.id)[0]).toBe("no_show");
  });

  it("una reserva que no existe, o de otro local, no se toca", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal("pro", { miembros: false });
    await addMembership(service, stranger, otro.id, "owner");
    const r = ok(await reservar(owner.db, l));
    expect((await stranger.db.rpc("set_reservation_status", { p_reservation: r.id, p_status: "cancelled" })).error?.message).toBe("reservations_not_allowed");
    expect((await stranger.db.rpc("assign_reservation_table", { p_reservation: r.id, p_table: otro.table })).error?.message).toBe("reservations_not_allowed");
    expect((await owner.db.rpc("set_reservation_status", { p_reservation: randomUUID(), p_status: "cancelled" })).error?.message).toBe("reservation_not_found");
    expect(estado(r.id)[0]).toBe("requested");
  });
});

describe("la purga", () => {
  const insertar = (l: Local, dias: number) =>
    sql(
      `insert into public.reservations (organization_id, branch_id, status, guest_name, guest_phone, party_size, starts_at, ends_at, client_key, request_hash) values ` +
        `('${l.id}', '${l.branch}', 'cancelled', 'Vieja', '123456', 2, now() - interval '${dias} days', now() - interval '${dias} days' + interval '1 hour', gen_random_uuid(), 'x') returning id`,
    )[0][0];

  it("borra lo terminado hace más de 30 días y respeta lo vigente; solo el servicio técnico la llama", async () => {
    const l = await nuevoLocal();
    const vieja = insertar(l, 40);
    const reciente = insertar(l, 10);
    const futura = ok(await reservar(owner.db, l)).id;

    for (const db of [anonClient(), owner.db, staff.db]) expect((await db.rpc("purge_expired_reservations", {})).error).not.toBeNull();
    const r = await service.rpc("purge_expired_reservations", {});
    expect(r.error).toBeNull();
    expect(Number(r.data)).toBeGreaterThanOrEqual(1);
    const quedan = sql(`select id from public.reservations where organization_id = '${l.id}'`).map((f) => f[0]);
    expect(quedan).not.toContain(vieja);
    expect(quedan).toContain(reciente);
    expect(quedan).toContain(futura);
  });

  it("rechaza una retención menor a 7 días y un lote inválido", async () => {
    expect((await service.rpc("purge_expired_reservations", { p_retention: "1 day" })).error?.message).toBe("invalid_retention");
    expect((await service.rpc("purge_expired_reservations", { p_retention: "-1 day" })).error?.message).toBe("invalid_retention");
    expect((await service.rpc("purge_expired_reservations", { p_batch: 0 })).error?.message).toBe("invalid_batch");
    expect((await service.rpc("purge_expired_reservations", { p_batch: 5001 })).error?.message).toBe("invalid_batch");
  });
});
