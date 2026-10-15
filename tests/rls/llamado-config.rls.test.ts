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
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Configuración del llamado (ficha configuracion-del-llamado) en la base: quién puede silenciar una mesa y cambiar el
 * cooldown, el tope de 24 horas del silencio, la cuenta bloqueada y que ninguna otra columna se abra. Contra el
 * Supabase local.
 */

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const INVALID_PARAMETER = "22023";
const LIMIT_EXCEEDED = "53400";
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser; // dueño de otra organización
const orgs: string[] = [];

type Local = { id: string; branch: string; table: string; token: string; table2: string };

async function nuevoLocal(slug: string, plan: "basic" | "pro" = "pro"): Promise<Local> {
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  const branch = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  if (branch.error) throw new Error(branch.error.message);
  const tables = await service
    .from("tables")
    .insert([
      { organization_id: id, branch_id: branch.data.id, label: "Mesa 1" },
      { organization_id: id, branch_id: branch.data.id, label: "Mesa 2" },
    ])
    .select("id, label, qr_token")
    .order("label");
  if (tables.error) throw new Error(tables.error.message);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: branch.data.id, table: tables.data[0].id, token: tables.data[0].qr_token, table2: tables.data[1].id };
}

const silenciar = (db: Db, tableId: string, until: string | null) =>
  db.from("tables").update({ muted_until: until }).eq("id", tableId).select("id, muted_until");
const cooldown = (db: Db, branchId: string, seconds: number) =>
  db.from("branches").update({ waiter_call_cooldown_seconds: seconds }).eq("id", branchId).select("id, waiter_call_cooldown_seconds");

const mutedUntilDe = async (tableId: string) => (await service.from("tables").select("muted_until").eq("id", tableId).single()).data?.muted_until;
const cooldownDe = async (branchId: string) =>
  (await service.from("branches").select("waiter_call_cooldown_seconds").eq("id", branchId).single()).data?.waiter_call_cooldown_seconds;

async function llamar(token: string, kind = "waiter"): Promise<Record<string, unknown>> {
  const { data, error } = await anonClient().rpc("create_waiter_call", { p_token: token, p_kind: kind });
  expect(error).toBeNull();
  return data as Record<string, unknown>;
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ajeno] = await Promise.all([
    createUser(service, "llcfg-owner"),
    createUser(service, "llcfg-staff"),
    createUser(service, "llcfg-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, ajeno].map((u) => deleteUser(service, u)));
});

describe("silenciar una mesa", () => {
  it("el Dueño y el Staff silencian y quitan el silencio; mientras dura no se puede llamar y calls_enabled es falso", async () => {
    const local = await nuevoLocal("tt-cfg-silencio");
    expect((await llamar(local.token)).status).toBe("created");

    for (const persona of [owner, staff]) {
      const hasta = iso(30 * MIN);
      const silenciada = await silenciar(persona.db, local.table, hasta);
      expect(silenciada.error).toBeNull();
      expect(silenciada.data).toHaveLength(1);
      expect(Date.parse((await mutedUntilDe(local.table))!)).toBe(Date.parse(hasta));

      // La disponibilidad la decide la base y no distingue la causa.
      expect(await llamar(local.token, "bill")).toEqual({ status: "unavailable" });
      const resuelta = await anonClient().rpc("resolve_table_qr", { p_token: local.token });
      expect(resuelta.data).toMatchObject({ calls_enabled: false });

      const quitada = await silenciar(persona.db, local.table, null);
      expect(quitada.error).toBeNull();
      expect(quitada.data).toHaveLength(1);
      expect(await mutedUntilDe(local.table)).toBeNull();
      expect((await anonClient().rpc("resolve_table_qr", { p_token: local.token })).data).toMatchObject({ calls_enabled: true });
    }
    expect((await llamar(local.token, "bill")).status).toBe("created");
  });

  it("silenciar una mesa no afecta a las demás ni cambia su nombre, estado o token", async () => {
    const local = await nuevoLocal("tt-cfg-aislada");
    const antes = (await service.from("tables").select("id, label, is_active, qr_token").eq("id", local.table).single()).data;
    expect((await silenciar(owner.db, local.table, iso(15 * MIN))).error).toBeNull();
    const despues = (await service.from("tables").select("id, label, is_active, qr_token").eq("id", local.table).single()).data;
    expect(despues).toEqual(antes);
    expect(await mutedUntilDe(local.table2)).toBeNull();
  });

  it("un silencio vencido ya no impide llamar", async () => {
    const local = await nuevoLocal("tt-cfg-vencido");
    expect((await silenciar(owner.db, local.table, iso(-MIN))).error).toBeNull();
    expect((await llamar(local.token)).status).toBe("created");
  });

  it("el tope es de 24 horas: 24 h pasan, 25 h se rechazan y el valor guardado no cambia", async () => {
    const local = await nuevoLocal("tt-cfg-tope");
    expect((await silenciar(owner.db, local.table, iso(24 * HORA))).error).toBeNull();
    const guardado = await mutedUntilDe(local.table);

    for (const exceso of [25 * HORA, 3 * DIA_MS, 365 * DIA_MS]) {
      const rechazado = await silenciar(staff.db, local.table, iso(exceso));
      expect(rechazado.error?.code).toBe(INVALID_PARAMETER);
      expect(await mutedUntilDe(local.table)).toBe(guardado);
    }
    // El tope también vale para la clave de servicio (es una regla de la base, no de la pantalla).
    expect((await silenciar(service, local.table, iso(48 * HORA))).error?.code).toBe(INVALID_PARAMETER);
  });

  it("volver a guardar el mismo valor no se rechaza aunque el tope ya haya pasado (solo cuenta el valor nuevo)", async () => {
    const local = await nuevoLocal("tt-cfg-mismo");
    const hasta = iso(23 * HORA);
    expect((await silenciar(owner.db, local.table, hasta)).error).toBeNull();
    const guardado = (await mutedUntilDe(local.table))!;
    expect((await silenciar(owner.db, local.table, guardado)).error).toBeNull();
  });

  it("una mesa inactiva también se silencia, sin reactivarla ni consumir cupo", async () => {
    const local = await nuevoLocal("tt-cfg-inactiva");
    await service.from("tables").update({ is_active: false }).eq("id", local.table);
    expect((await silenciar(owner.db, local.table, iso(15 * MIN))).error).toBeNull();
    expect((await service.from("tables").select("is_active").eq("id", local.table).single()).data?.is_active).toBe(false);
  });

  it("silenciar con el cupo de mesas activas lleno no se bloquea (no consume cupo)", async () => {
    const local = await nuevoLocal("tt-cfg-cupo", "basic");
    const faltan = 20 - 2;
    const filas = Array.from({ length: faltan }, (_, i) => ({ organization_id: local.id, branch_id: local.branch, label: `Extra ${i + 1}` }));
    expect((await service.from("tables").insert(filas)).error).toBeNull();
    // Comprobación de que el cupo está lleno de verdad.
    const lleno = await owner.db.from("tables").insert({ organization_id: local.id, branch_id: local.branch, label: "Una más" });
    expect(lleno.error?.code).toBe(LIMIT_EXCEEDED);

    expect((await silenciar(staff.db, local.table, iso(15 * MIN))).error).toBeNull();
    expect((await silenciar(staff.db, local.table, null)).error).toBeNull();
  });

  it("un miembro de otra organización no puede silenciar ni ver la mesa; anon tampoco", async () => {
    const local = await nuevoLocal("tt-cfg-ajena");
    const intento = await silenciar(ajeno.db, local.table, iso(15 * MIN));
    expect(intento.error).toBeNull();
    expect(intento.data).toHaveLength(0); // RLS: 0 filas, sin error
    expect(await mutedUntilDe(local.table)).toBeNull();

    const anon = await silenciar(anonClient(), local.table, iso(15 * MIN));
    expect(anon.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await mutedUntilDe(local.table)).toBeNull();
  });

  it("con la cuenta en solo lectura o suspendida no se silencia ni se quita el silencio (ninguna fila cambia)", async () => {
    const local = await nuevoLocal("tt-cfg-mora");
    expect((await silenciar(owner.db, local.table, iso(60 * MIN))).error).toBeNull();
    const guardado = await mutedUntilDe(local.table);

    for (const dias of [10, 20]) {
      await setSubscription(service, local.id, { finEnMs: -dias * DIA_MS });
      for (const persona of [owner, staff]) {
        const quitar = await silenciar(persona.db, local.table, null);
        expect(quitar.data ?? []).toHaveLength(0);
        const otra = await silenciar(persona.db, local.table2, iso(15 * MIN));
        expect(otra.data ?? []).toHaveLength(0);
      }
      expect(await mutedUntilDe(local.table)).toBe(guardado);
      expect(await mutedUntilDe(local.table2)).toBeNull();
    }
    // En gracia se edita con normalidad.
    await setSubscription(service, local.id, { finEnMs: -3 * DIA_MS });
    expect((await silenciar(staff.db, local.table, null)).data).toHaveLength(1);
  });
});

describe("cooldown por sucursal", () => {
  it("el Dueño lo cambia y rige para los llamados nuevos; el borde inferior (10 s) y el superior (3600 s) valen", async () => {
    const local = await nuevoLocal("tt-cfg-cooldown");
    expect((await cooldown(owner.db, local.branch, 600)).data).toEqual([{ id: local.branch, waiter_call_cooldown_seconds: 600 }]);
    expect((await llamar(local.token)).status).toBe("created");
    await service.from("waiter_calls").update({ status: "attended" }).eq("table_id", local.table);
    const espera = await llamar(local.token);
    expect(espera.status).toBe("cooldown");
    expect(espera.retry_after_seconds as number).toBeGreaterThan(60); // con el valor por defecto (60 s) sería ≤ 60

    expect((await cooldown(owner.db, local.branch, 10)).error).toBeNull();
    expect(await cooldownDe(local.branch)).toBe(10);
    expect((await cooldown(owner.db, local.branch, 3600)).error).toBeNull();
    expect(await cooldownDe(local.branch)).toBe(3600);
  });

  it("fuera de 10 a 3600 la base rechaza y conserva el valor", async () => {
    const local = await nuevoLocal("tt-cfg-rango");
    for (const invalido of [9, 3601, 0, -5]) {
      expect((await cooldown(owner.db, local.branch, invalido)).error?.code).toBe(CHECK_VIOLATION);
    }
    expect(await cooldownDe(local.branch)).toBe(60);
  });

  it("el Staff no lo cambia: 0 filas sin error y el valor queda igual", async () => {
    const local = await nuevoLocal("tt-cfg-staff");
    const intento = await cooldown(staff.db, local.branch, 300);
    expect(intento.error).toBeNull();
    expect(intento.data).toHaveLength(0);
    expect(await cooldownDe(local.branch)).toBe(60);
  });

  it("otro Dueño, anon y la cuenta bloqueada tampoco lo cambian", async () => {
    const local = await nuevoLocal("tt-cfg-cd-bloqueos");
    expect((await cooldown(ajeno.db, local.branch, 300)).data).toHaveLength(0);
    expect((await cooldown(anonClient(), local.branch, 300)).error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    for (const dias of [10, 20]) {
      await setSubscription(service, local.id, { finEnMs: -dias * DIA_MS });
      expect((await cooldown(owner.db, local.branch, 300)).data ?? []).toHaveLength(0);
    }
    expect(await cooldownDe(local.branch)).toBe(60);
    await setSubscription(service, local.id, { finEnMs: -3 * DIA_MS });
    expect((await cooldown(owner.db, local.branch, 300)).data).toHaveLength(1); // gracia
  });
});

describe("lo demás sigue cerrado", () => {
  it("nadie mueve una mesa de sucursal u organización, fija su token ni toca columnas ajenas a esta configuración", async () => {
    const local = await nuevoLocal("tt-cfg-cerrado");
    for (const persona of [owner, staff]) {
      for (const cambio of [
        { organization_id: "00000000-0000-4000-8000-000000000000" },
        { branch_id: "00000000-0000-4000-8000-000000000000" },
        { id: "00000000-0000-4000-8000-000000000000" },
        { created_at: iso(-DIA_MS) },
      ]) {
        const r = await persona.db.from("tables").update(cambio).eq("id", local.table).select("id");
        expect(r.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
    }
    const rama = await owner.db.from("branches").update({ slug: "otro" }).eq("id", local.branch).select("id");
    expect(rama.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const org = await owner.db.from("branches").update({ organization_id: "00000000-0000-4000-8000-000000000000" }).eq("id", local.branch);
    expect(org.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("el llamado sigue sin poder escribirse por la API (ni el Dueño inserta, borra ni cambia otra columna)", async () => {
    const local = await nuevoLocal("tt-cfg-llamado-cerrado");
    expect((await llamar(local.token)).status).toBe("created");
    const insertar = await owner.db.from("waiter_calls").insert({ organization_id: local.id, branch_id: local.branch, table_id: local.table, kind: "bill" });
    expect(insertar.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const borrar = await owner.db.from("waiter_calls").delete().eq("table_id", local.table);
    expect(borrar.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const cliente = await owner.db.from("waiter_calls").update({ client_key: "a".repeat(32) }).eq("table_id", local.table);
    expect(cliente.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("la función del tope no se puede invocar por la API", async () => {
    const { error } = await owner.db.rpc("limit_table_mute" as never);
    expect(error).not.toBeNull();
  });
});
