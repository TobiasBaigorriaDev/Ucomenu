import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
  createCategory,
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
 * Turno de mesa (nivel C, ficha turno-de-mesa, ADR 0044) contra el Supabase local: cerrar o anular un pedido y el reinicio manual
 * mueven el turno de la mesa; repetir no; nadie de la API escribe la columna; cerrar nunca depende del plan ni de la mora; y un ticket
 * de visita anterior (o igual) al turno ya no vale.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; branch: string; table: string; table2: string; product: string };

async function nuevoLocal(): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-turno-${sufijo}-${contador}`, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal: ${b.error.message}`);
  const mesas = await service
    .from("tables")
    .insert([
      { organization_id: id, branch_id: b.data.id, label: "Mesa 1" },
      { organization_id: id, branch_id: b.data.id, label: "Mesa 2" },
    ])
    .select("id, label")
    .order("label");
  if (mesas.error) throw new Error(`mesas: ${mesas.error.message}`);
  const category = await createCategory(service, id, "Platos");
  const p = await service.from("products").insert({ organization_id: id, category_id: category, name: "Bife", price_cents: 10000 }).select("id").single();
  if (p.error) throw new Error(`plato: ${p.error.message}`);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: b.data.id, table: mesas.data[0].id, table2: mesas.data[1].id, product: p.data.id };
}

type Resp = { data: unknown; error: { message: string } | null };
const ok = <T,>(r: Resp): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

const anotar = async (db: Db, l: Local, table = l.table) =>
  ok<{ order_id: string }>(
    await db.rpc("add_order_item", { p_branch: l.branch, p_table: table, p_product: l.product, p_quantity: 1, p_client_key: randomUUID() } as never),
  ).order_id;
const cerrar = (db: Db, order: string) => db.rpc("close_order", { p_order: order } as never);
const anular = (db: Db, order: string, reason: string | null = "se fueron") => db.rpc("void_order", { p_order: order, p_reason: reason } as never);
const reiniciar = (db: Db, table: string) => db.rpc("reset_table_turn", { p_table: table } as never);

/** El inicio del turno, en texto con microsegundos (para comparar sin perder precisión). */
const turno = (table: string) => sql(`select turn_started_at::text from public.tables where id = '${table}'`)[0][0];
/** Espera una pizca para que dos `clock_timestamp()` no coincidan. */
const pausa = () => new Promise((r) => setTimeout(r, 15));
/** Espera activa en vez de un tiempo fijo: bajo carga `docker exec` tarda en arrancar y una pausa corta daba falsos fallos. */
const hasta = async (condicion: () => boolean, ms = 12_000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (condicion()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return condicion();
};
/** La sesión retenedora (su consulta lleva `marca`) ya llegó a su `pg_sleep`: ya tiene los candados y los conserva. */
const durmiendo = (marca: string) => Number(sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marca}%'`)[0][0]) > 0;
/** Hay una sesión esperando un candado dentro de una consulta que menciona `fragmento` (y, si se pide, de ese tipo de espera). */
const bloqueada = (fragmento: string, evento?: string) =>
  Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' ${evento ? `and wait_event = '${evento}'` : ""} and query like '%${fragmento}%'`)[0][0]) > 0;
/** Termina la sesión retenedora (deshace su transacción y suelta sus candados) sin esperar a que acabe su sueño. */
const soltar = (marca: string) => sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marca}%'`);
const enTurno = (table: string, ticketSql: string) => sql(`select private.ticket_in_turn('${table}', ${ticketSql})`)[0][0] === "t";

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "turno-owner"),
    createUser(service, "turno-staff"),
    createUser(service, "turno-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("el turno rota al cerrar o anular un pedido", () => {
  it("cerrar mueve el turno de ESA mesa y repetir el cierre no lo mueve", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    const otra = turno(l.table2);
    const antes = turno(l.table);
    await pausa();
    expect(ok(await cerrar(staff.db, order))).toMatchObject({ status: "closed", unchanged: false });
    const despues = turno(l.table);
    expect(despues > antes).toBe(true);
    expect(turno(l.table2)).toBe(otra);

    await pausa();
    expect(ok(await cerrar(owner.db, order))).toMatchObject({ unchanged: true });
    expect(turno(l.table)).toBe(despues);
  });

  it("anular mueve el turno y repetir la anulación no", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    const antes = turno(l.table);
    await pausa();
    expect(ok(await anular(owner.db, order))).toMatchObject({ status: "void", unchanged: false });
    const despues = turno(l.table);
    expect(despues > antes).toBe(true);
    await pausa();
    expect(ok(await anular(owner.db, order))).toMatchObject({ unchanged: true });
    expect(turno(l.table)).toBe(despues);
  });

  it("un cierre que falla (anular uno ya cerrado, anular sin motivo, ajeno) no mueve el turno", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    const antes = turno(l.table);
    expect((await anular(owner.db, order, null)).error?.message).toBe("reason_required");
    expect((await cerrar(stranger.db, order)).error?.message).toBe("orders_not_allowed");
    expect(turno(l.table)).toBe(antes);
    ok(await cerrar(owner.db, order));
    const cerrado = turno(l.table);
    expect((await anular(owner.db, order)).error?.message).toBe("order_not_open");
    expect(turno(l.table)).toBe(cerrado);
  });

  it("un pedido cuya mesa se borró se cierra igual, sin error ni turno que mover", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l, l.table2);
    const borrada = await service.from("tables").delete().eq("id", l.table2);
    expect(borrada.error).toBeNull();
    expect(ok(await cerrar(owner.db, order))).toMatchObject({ status: "closed", unchanged: false });
  });

  it("cerrar y anular siguen funcionando con el plan dado de baja o la cuenta vencida, y mueven el turno", async () => {
    const l = await nuevoLocal();
    const a = await anotar(owner.db, l);
    const b = await anotar(owner.db, l, l.table2);
    await setSubscription(service, l.id, { plan: "basic", finEnMs: -60 * DIA_MS });
    const antesA = turno(l.table);
    const antesB = turno(l.table2);
    await pausa();
    expect(ok(await cerrar(owner.db, a))).toMatchObject({ status: "closed" });
    expect(ok(await anular(staff.db, b))).toMatchObject({ status: "void" });
    expect(turno(l.table) > antesA).toBe(true);
    expect(turno(l.table2) > antesB).toBe(true);
  });
});

describe("reinicio manual del turno", () => {
  it("el Dueño y el Staff lo reinician; el QR (token) no cambia", async () => {
    const l = await nuevoLocal();
    const token = () => sql(`select qr_token from public.tables where id = '${l.table}'`)[0][0];
    const qr = token();
    const antes = turno(l.table);
    await pausa();
    const r = ok<{ table_id: string; turn_started_at: string }>(await reiniciar(staff.db, l.table));
    expect(r.table_id).toBe(l.table);
    const medio = turno(l.table);
    expect(medio > antes).toBe(true);
    await pausa();
    ok(await reiniciar(owner.db, l.table));
    expect(turno(l.table) > medio).toBe(true);
    expect(token()).toBe(qr);
  });

  it("otra organización, mesa inexistente y no uuid dan el mismo error; anon no puede ejecutarla", async () => {
    const l = await nuevoLocal();
    const antes = turno(l.table);
    expect((await reiniciar(stranger.db, l.table)).error?.message).toBe("table_not_found");
    expect((await reiniciar(owner.db, randomUUID())).error?.message).toBe("table_not_found");
    expect((await reiniciar(owner.db, "no-es-uuid")).error).not.toBeNull();
    const anon = await anonClient().rpc("reset_table_turn", { p_table: l.table } as never);
    expect(anon.error).not.toBeNull();
    expect(turno(l.table)).toBe(antes);
  });

  it("funciona aunque el plan ya no incluya los pedidos ni la Sala", async () => {
    const l = await nuevoLocal();
    await setSubscription(service, l.id, { plan: "basic", finEnMs: -60 * DIA_MS });
    const antes = turno(l.table);
    await pausa();
    ok(await reiniciar(owner.db, l.table));
    expect(turno(l.table) > antes).toBe(true);
  });
});

describe("la columna no se escribe desde la API", () => {
  it("ni el Dueño ni el Staff ni anon pueden actualizar turn_started_at", async () => {
    const l = await nuevoLocal();
    const antes = turno(l.table);
    for (const db of [owner.db, staff.db]) {
      const r = await db.from("tables").update({ turn_started_at: "2099-01-01T00:00:00Z" } as never).eq("id", l.table).select("id");
      expect(r.error).not.toBeNull();
    }
    const anon = await anonClient().from("tables").update({ turn_started_at: "2099-01-01T00:00:00Z" } as never).eq("id", l.table).select("id");
    expect(anon.error !== null || (anon.data ?? []).length === 0).toBe(true);
    expect(turno(l.table)).toBe(antes);
  });

  it("el Dueño sigue pudiendo cambiar la etiqueta y regenerar el QR (permisos de antes)", async () => {
    const l = await nuevoLocal();
    const r = await owner.db.from("tables").update({ label: "Terraza" }).eq("id", l.table).select("label").single();
    expect(r.error).toBeNull();
    expect(r.data?.label).toBe("Terraza");
  });
});

describe("ticket_in_turn", () => {
  it("un ticket anterior o igual al inicio del turno no vale; uno posterior sí; sin ticket no", async () => {
    const l = await nuevoLocal();
    ok(await reiniciar(owner.db, l.table));
    const t = `'${turno(l.table)}'::timestamptz`;
    expect(enTurno(l.table, `${t} - interval '1 second'`)).toBe(false);
    expect(enTurno(l.table, t)).toBe(false);
    expect(enTurno(l.table, `${t} + interval '1 millisecond'`)).toBe(true);
    expect(enTurno(l.table, `${t} + interval '1 hour'`)).toBe(true);
    expect(enTurno(l.table, "null")).toBe(false);
  });

  it("una mesa inexistente nunca está en turno", () => {
    expect(enTurno(randomUUID(), "now()")).toBe(false);
  });

  it("un ticket que valía deja de valer al cerrar el pedido de la mesa", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    await pausa();
    const emitido = "clock_timestamp()";
    expect(enTurno(l.table, emitido)).toBe(true);
    const ticket = sql(`select clock_timestamp()::text`)[0][0];
    await pausa();
    ok(await cerrar(owner.db, order));
    expect(enTurno(l.table, `'${ticket}'::timestamptz`)).toBe(false);
  });
});

describe("la autorización se revalida después de esperar la fila de la mesa (hallazgo de la revisión, ronda 1)", () => {
  /** Otra sesión retiene la fila de la mesa unos segundos; `llamada` queda esperándola y, mientras, se revoca la membresía. */
  async function revocandoMientrasEspera(l: Local, userId: string, llamada: () => PromiseLike<Resp>, fragmento: string): Promise<Resp> {
    const retiene = spawn(
      "docker",
      ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", `begin; select 1 from public.tables where id = '${l.table}' for update; select pg_sleep(30); commit;`],
      { stdio: "ignore" },
    );
    const termino = new Promise((r) => retiene.on("exit", r));
    expect(await hasta(() => durmiendo(l.table))).toBe(true);
    const espera = llamada().then((r) => r);
    expect(await hasta(() => bloqueada(fragmento))).toBe(true);
    expect((await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", userId)).error).toBeNull();
    soltar(l.table);
    const r = await espera;
    await termino;
    await addMembership(service, staff, l.id, "staff");
    return r;
  }

  it("reiniciar, cerrar y anular: una membresía revocada mientras esperan la mesa no las deja pasar", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    const antes = turno(l.table);

    const r = await revocandoMientrasEspera(l, staff.id, () => reiniciar(staff.db, l.table), "reset_table_turn");
    expect(r.error?.message).toBe("table_not_found");
    const c = await revocandoMientrasEspera(l, staff.id, () => cerrar(staff.db, order), "close_order");
    expect(c.error?.message).toBe("orders_not_allowed");
    const a = await revocandoMientrasEspera(l, staff.id, () => anular(staff.db, order, "x"), "void_order");
    expect(a.error?.message).toBe("orders_not_allowed");

    expect(turno(l.table)).toBe(antes);
    expect(sql(`select status from public.orders where id = '${order}'`)[0][0]).toBe("open");
  });
});

describe("cerrar y borrar la mesa a la vez no se traban (hallazgo de la revisión, ronda 1)", () => {
  it("el orden de bloqueo es mesa → pedido, como el de borrar una mesa: sin deadlock, el cierre se completa", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    // Otra sesión toma la mesa, espera, y la borra (la FK pone `table_id` en NULL en sus pedidos: necesita el pedido).
    const borra = spawn(
      "docker",
      ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", `begin; select 1 from public.tables where id = '${l.table}' for update; select pg_sleep(6); delete from public.tables where id = '${l.table}'; commit;`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let salida = "";
    borra.stderr.on("data", (d) => (salida += String(d)));
    const termino = new Promise<number | null>((r) => borra.on("exit", r));
    expect(await hasta(() => durmiendo(l.table))).toBe(true);
    const cierreEnCurso = cerrar(staff.db, order).then((r) => r); // `.then` dispara la petición (el builder de supabase-js es perezoso)
    // El cierre ya está esperando la mesa (retenida por la otra sesión): hay competencia real, no dos operaciones seguidas.
    expect(await hasta(() => bloqueada("close_order"))).toBe(true);
    const cierre = await cierreEnCurso;
    const codigo = await termino;

    expect(salida).not.toMatch(/deadlock/i);
    expect(codigo).toBe(0);
    expect(cierre.error).toBeNull();
    expect(sql(`select status, coalesce(table_id::text, 'sin-mesa') from public.orders where id = '${order}'`)[0]).toEqual(["closed", "sin-mesa"]);
    expect(sql(`select count(*) from public.tables where id = '${l.table}'`)[0][0]).toBe("0");
  });
});

describe("el pedido de cuenta pendiente se da por vencido al terminar el turno (hallazgo de la revisión, ronda 1 de cuenta-del-comensal)", () => {
  const llamados = (table: string) => sql(`select kind, status from public.waiter_calls where table_id = '${table}' order by kind`);
  const llamar = async (l: Local, kind: "bill" | "waiter") => ok(await service.rpc("create_waiter_call", { p_token: sql(`select qr_token from public.tables where id = '${l.table}'`)[0][0], p_kind: kind } as never));

  it("cerrar y anular vencen el «Pedir la cuenta» pendiente de ESA mesa; el «Llamar al mozo» y los de otra mesa quedan", async () => {
    const l = await nuevoLocal();
    const a = await anotar(owner.db, l);
    const b = await anotar(owner.db, l, l.table2);
    await llamar(l, "bill");
    await llamar(l, "waiter");
    const token2 = sql(`select qr_token from public.tables where id = '${l.table2}'`)[0][0];
    ok(await service.rpc("create_waiter_call", { p_token: token2, p_kind: "bill" } as never));

    ok(await cerrar(owner.db, a));
    expect(llamados(l.table)).toEqual([["bill", "expired"], ["waiter", "pending"]]);
    expect(llamados(l.table2)).toEqual([["bill", "pending"]]);

    ok(await anular(owner.db, b));
    expect(llamados(l.table2)).toEqual([["bill", "expired"]]);
  });

  it("un cierre repetido o fallido no toca los llamados, y el reinicio manual sí vence el pedido de cuenta", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    await llamar(l, "bill");
    expect((await anular(owner.db, order, null)).error?.message).toBe("reason_required");
    expect((await cerrar(stranger.db, order)).error?.message).toBe("orders_not_allowed");
    expect(llamados(l.table)).toEqual([["bill", "pending"]]);

    ok(await reiniciar(staff.db, l.table));
    expect(llamados(l.table)).toEqual([["bill", "expired"]]);
  });
});

describe("un «Pedir la cuenta» que se está creando mientras se cierra la mesa no queda pendiente del turno anterior (hallazgo de la revisión, ronda 2)", () => {
  it("el cierre espera al llamado en curso (mismo candado de la mesa) y después lo vence", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    const token = sql(`select qr_token from public.tables where id = '${l.table}'`)[0][0];
    // Otra transacción CREA el pedido de cuenta y lo deja sin confirmar unos segundos.
    const crea = spawn(
      "docker",
      ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", `begin; select public.create_waiter_call('${token}', 'bill'); select pg_sleep(6); commit;`],
      { stdio: "ignore" },
    );
    const termino = new Promise((r) => crea.on("exit", r));
    expect(await hasta(() => durmiendo(token))).toBe(true);
    const cierre = cerrar(staff.db, order).then((r) => r);
    // El cierre está esperando un candado asesor (el de los llamados de esa mesa).
    expect(await hasta(() => bloqueada("close_order", "advisory"))).toBe(true);
    const r = await cierre;
    await termino;

    expect(r.error).toBeNull();
    // Sin esa espera quedaba un `pending` con fecha anterior al turno, que taparía el pedido de la mesa nueva.
    expect(sql(`select kind, status from public.waiter_calls where table_id = '${l.table}'`)).toEqual([["bill", "expired"]]);
    expect(sql(`select status from public.orders where id = '${order}'`)[0][0]).toBe("closed");
  });
});

describe("las esperas del candado de los llamados (hallazgos de la revisión, ronda 3)", () => {
  const retener = (sqlTexto: string) => {
    const proceso = spawn("docker", ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", sqlTexto], { stdio: "ignore" });
    return new Promise((r) => proceso.on("exit", r));
  };
  const llamados = (table: string) => sql(`select kind, status from public.waiter_calls where table_id = '${table}' order by kind`);

  it("un «Pedir la cuenta» que espera el candado mientras el turno termina usa el turno NUEVO para su cooldown", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    const token = sql(`select qr_token from public.tables where id = '${l.table}'`)[0][0];
    ok(await service.rpc("create_waiter_call", { p_token: token, p_kind: "bill" } as never));
    // Otra transacción CIERRA el pedido (con la identidad del Dueño) y tarda en confirmar.
    const termina = retener(
      `begin; select set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true); select public.close_order('${order}'); select pg_sleep(6); commit;`,
    );
    expect(await hasta(() => durmiendo(order))).toBe(true);
    const pide = service.rpc("create_waiter_call", { p_token: token, p_kind: "bill" } as never).then((r) => r);
    expect(await hasta(() => bloqueada("create_waiter_call", "advisory"))).toBe(true);
    const r = await pide;
    await termina;
    // Con el turno viejo contaba el llamado vencido de hace segundos y respondía `cooldown`, sin llamado del turno vigente.
    expect(ok<{ status: string }>(r).status).toBe("created");
    expect(llamados(l.table)).toEqual([["bill", "expired"], ["bill", "pending"]]);
  });

  /** Otra sesión retiene el candado de los llamados de la mesa; `llamada` espera DENTRO de `end_table_turn` y se revoca su membresía. */
  async function revocandoMientrasEsperaElCandado(l: Local, userId: string, llamada: () => PromiseLike<Resp>, fragmento: string): Promise<Resp> {
    const retiene = retener(`begin; select pg_advisory_xact_lock(hashtextextended('waiter_call:' || '${l.table}', 0)); select pg_sleep(30); commit;`);
    expect(await hasta(() => durmiendo(l.table))).toBe(true);
    const espera = llamada().then((r) => r);
    expect(await hasta(() => bloqueada(fragmento, "advisory"))).toBe(true);
    expect((await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", userId)).error).toBeNull();
    soltar(l.table);
    const r = await espera;
    await retiene;
    await addMembership(service, staff, l.id, "staff");
    return r;
  }

  it("reiniciar, cerrar y anular: una membresía revocada mientras esperan ese candado no las deja pasar ni vencer el pedido de cuenta", async () => {
    const l = await nuevoLocal();
    const order = await anotar(owner.db, l);
    const token = sql(`select qr_token from public.tables where id = '${l.table}'`)[0][0];
    ok(await service.rpc("create_waiter_call", { p_token: token, p_kind: "bill" } as never));
    const antes = turno(l.table);

    const r = await revocandoMientrasEsperaElCandado(l, staff.id, () => reiniciar(staff.db, l.table), "reset_table_turn");
    expect(r.error?.message).toBe("table_not_found");
    const c = await revocandoMientrasEsperaElCandado(l, staff.id, () => cerrar(staff.db, order), "close_order");
    expect(c.error?.message).toBe("orders_not_allowed");
    const a = await revocandoMientrasEsperaElCandado(l, staff.id, () => anular(staff.db, order, "x"), "void_order");
    expect(a.error?.message).toBe("orders_not_allowed");

    expect(turno(l.table)).toBe(antes);
    expect(llamados(l.table)).toEqual([["bill", "pending"]]);
    expect(sql(`select status from public.orders where id = '${order}'`)[0][0]).toBe("open");
  });
});

describe("los llamados también terminan con el turno de la mesa (feedback del usuario en staging)", () => {
  const token = (table: string) => sql(`select qr_token from public.tables where id = '${table}'`)[0][0];
  /** Un instante relativo al inicio del turno de la mesa, como texto de timestamptz (la base lo interpreta; es el ticket de visita). */
  const relativoAlTurno = (table: string, intervalo: string) => sql(`select (turn_started_at ${intervalo})::text from public.tables where id = '${table}'`)[0][0];
  const llamar = async (table: string, ticket: string | null, kind: "waiter" | "bill" = "waiter") =>
    ok<{ status: string }>(
      await service.rpc("create_waiter_call", { p_token: token(table), p_kind: kind, ...(ticket === null ? {} : { p_visit_started_at: ticket }) } as never),
    ).status;
  const cuantos = (table: string) => Number(sql(`select count(*) from public.waiter_calls where table_id = '${table}'`)[0][0]);

  it("tras «Reiniciar QR», el ticket de antes ya no llama; el de después sí; sin ticket (directo a la API) tampoco se ve afectado", async () => {
    const l = await nuevoLocal();
    // El comensal escaneó hace 10 s (el turno de una mesa recién creada empezó con ella: se atrasa para que el ticket sea válido).
    sql(`update public.tables set turn_started_at = now() - interval '1 hour' where id = '${l.table}'`);
    const viejo = sql("select (now() - interval '10 seconds')::text")[0][0];
    expect(await llamar(l.table, viejo)).toBe("created");
    sql(`delete from public.waiter_calls where table_id = '${l.table}'`);

    await pausa();
    ok(await reiniciar(staff.db, l.table));
    // Con el ticket anterior al turno: «escaneá de nuevo», y no se crea nada.
    expect(await llamar(l.table, viejo)).toBe("session_closed");
    expect(await llamar(l.table, viejo, "bill")).toBe("session_closed");
    expect(cuantos(l.table)).toBe(0);
    // Quien escanea después del reinicio llama con normalidad.
    expect(await llamar(l.table, relativoAlTurno(l.table, "+ interval '1 second'"))).toBe("created");
    // Sin ticket (llamar directo a la API, que la app no usa) no hay nada que comparar.
    sql(`delete from public.waiter_calls where table_id = '${l.table}'`);
    expect(await llamar(l.table, null)).toBe("created");
  });

  it("cobrar (cerrar) y anular el pedido también cortan los llamados del ticket anterior", async () => {
    const l = await nuevoLocal();
    sql(`update public.tables set turn_started_at = now() - interval '1 hour' where id in ('${l.table}', '${l.table2}')`);
    const a = await anotar(owner.db, l);
    const b = await anotar(owner.db, l, l.table2);
    const viejo = sql("select (now() - interval '10 seconds')::text")[0][0];
    await pausa();
    ok(await cerrar(owner.db, a));
    ok(await anular(owner.db, b));
    expect(await llamar(l.table, viejo)).toBe("session_closed");
    expect(await llamar(l.table2, viejo)).toBe("session_closed");
    expect(cuantos(l.table) + cuantos(l.table2)).toBe(0);
  });

  it("tolerancia de 1 s: un ticket del mismo segundo que el turno no se rechaza; uno de un segundo antes, sí", async () => {
    const l = await nuevoLocal();
    await pausa();
    ok(await reiniciar(owner.db, l.table));
    expect(await llamar(l.table, relativoAlTurno(l.table, "- interval '0.5 seconds'"))).toBe("created");
    sql(`delete from public.waiter_calls where table_id = '${l.table}'`);
    expect(await llamar(l.table, relativoAlTurno(l.table, "- interval '1 second'"))).toBe("session_closed");
    expect(cuantos(l.table)).toBe(0);
  });

  it("el turno de otra mesa no corta los llamados de ésta", async () => {
    const l = await nuevoLocal();
    sql(`update public.tables set turn_started_at = now() - interval '1 hour' where id in ('${l.table}', '${l.table2}')`);
    const viejo = sql("select (now() - interval '10 seconds')::text")[0][0];
    await pausa();
    ok(await reiniciar(owner.db, l.table2));
    expect(await llamar(l.table, viejo)).toBe("created");
    expect(await llamar(l.table2, viejo)).toBe("session_closed");
  });
});
