import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBranchTimeZone } from "@/lib/sucursales/branches";
import { BRANCH_TIME_ZONES, DEFAULT_BRANCH_TIME_ZONE, validateBranchTimeZone } from "@/lib/sucursales/rules";
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
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Zona horaria por sucursal (nivel M, ficha zona-horaria-por-sucursal) contra el Supabase local: el CHECK de la base acepta y
 * rechaza lo mismo que la validación local, Postgres conoce cada zona de la lista, solo el Dueño (con la cuenta al día) la
 * cambia y la facturación sigue en hora de Argentina.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; slug: string; branch: string };

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function nuevoLocal(plan: PlanCode = "basic"): Promise<Local> {
  contador += 1;
  const slug = `tt-zh-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal inicial: ${b.error.message}`);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, branch: b.data.id };
}

const guardada = async (branchId: string) => (await service.from("branches").select("timezone").eq("id", branchId).single()).data?.timezone;

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "zona-owner"),
    createUser(service, "zona-staff"),
    createUser(service, "zona-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("el valor por defecto y la lista", () => {
  it("toda sucursal nace en Buenos Aires, también la que se crea sin decir nada", async () => {
    const local = await nuevoLocal();
    expect(await guardada(local.branch)).toBe(DEFAULT_BRANCH_TIME_ZONE);
  });

  it("el alta de una sucursal por la API no puede fijar la zona (se cambia después)", async () => {
    const local = await nuevoLocal("pro");
    const r = await owner.db.from("branches").insert({ organization_id: local.id, slug: "otra", name: "Otra", timezone: "Europe/Madrid" });
    expect(r.error?.code).toBe("42501");
  });

  it("Postgres conoce cada zona de la lista (un `at time zone` no puede fallar en pleno cálculo)", () => {
    const lista = BRANCH_TIME_ZONES.map((z) => `'${z.id}'`).join(", ");
    const conocidas = sql(`select name from pg_timezone_names where name in (${lista}) order by name`).map((fila) => fila[0]);
    expect(conocidas).toEqual(BRANCH_TIME_ZONES.map((z) => z.id).sort());
  });

  it("paridad: la base y Intl dan la misma hora local para cada zona de la lista, en invierno y en verano de cada hemisferio", () => {
    const instantes = ["2026-01-15T03:30:00Z", "2026-07-15T03:30:00Z", "2026-12-21T02:30:00Z"];
    for (const { id } of BRANCH_TIME_ZONES) {
      for (const iso of instantes) {
        const [[enBase]] = sql(`select to_char(timestamptz '${iso}' at time zone '${id}', 'YYYY-MM-DD HH24:MI')`);
        const partes = Object.fromEntries(
          new Intl.DateTimeFormat("en-CA", { timeZone: id, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            .formatToParts(new Date(iso))
            .map((p) => [p.type, p.value]),
        );
        expect(enBase, `${id} ${iso}`).toBe(`${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}`);
      }
    }
  });
});

describe("el CHECK de la base y la validación local dicen lo mismo", () => {
  it("las zonas de la lista se aceptan y lo demás se rechaza con 23514", async () => {
    const local = await nuevoLocal();
    const casos: { zona: string; valida: boolean }[] = [
      ...BRANCH_TIME_ZONES.map((z) => ({ zona: z.id, valida: true })),
      ...["", "UTC", "EST", "america/lima", " America/Lima", "America/Lima ", "Etc/GMT+3", "posix/America/Lima", "America/Nowhere", "Asia/Tokyo"].map((zona) => ({
        zona,
        valida: false,
      })),
    ];
    for (const { zona, valida } of casos) {
      const r = await service.from("branches").update({ timezone: zona }).eq("id", local.branch);
      expect(r.error === null, `base: ${JSON.stringify(zona)}`).toBe(valida);
      expect(validateBranchTimeZone(zona).ok, `local: ${JSON.stringify(zona)}`).toBe(valida);
      if (!valida) expect(r.error?.code, JSON.stringify(zona)).toBe("23514");
    }
  });

  it("nula tampoco: toda sucursal tiene zona", async () => {
    const local = await nuevoLocal();
    const r = await service.from("branches").update({ timezone: null as unknown as string }).eq("id", local.branch);
    expect(r.error?.code).toBe("23502");
  });
});

describe("quién la cambia", () => {
  it("el Dueño la cambia y la vuelve a cambiar", async () => {
    const local = await nuevoLocal();
    expect(await setBranchTimeZone(owner.db, local.id, local.branch, "Europe/Madrid")).toEqual({ ok: true, data: undefined });
    expect(await guardada(local.branch)).toBe("Europe/Madrid");
    expect((await setBranchTimeZone(owner.db, local.id, local.branch, DEFAULT_BRANCH_TIME_ZONE)).ok).toBe(true);
    expect(await guardada(local.branch)).toBe(DEFAULT_BRANCH_TIME_ZONE);
  });

  it("una zona que no es de la lista se rechaza con un mensaje claro y no cambia nada", async () => {
    const local = await nuevoLocal();
    expect(await setBranchTimeZone(owner.db, local.id, local.branch, "Asia/Tokyo")).toEqual({ ok: false, error: "time_zone_invalid" });
    expect(await setBranchTimeZone(owner.db, local.id, local.branch, "")).toEqual({ ok: false, error: "time_zone_invalid" });
    expect(await guardada(local.branch)).toBe(DEFAULT_BRANCH_TIME_ZONE);
  });

  it("aunque se salteen la validación local, la API no deja guardar una zona ajena a la lista", async () => {
    const local = await nuevoLocal();
    const r = await owner.db.from("branches").update({ timezone: "Asia/Tokyo" }).eq("id", local.branch).select("id");
    expect(r.error?.code).toBe("23514");
    expect(await guardada(local.branch)).toBe(DEFAULT_BRANCH_TIME_ZONE);
  });

  it("el Staff, otra organización y anon no la cambian", async () => {
    const local = await nuevoLocal();
    const ajena = await nuevoLocal();
    const staffDirecto = await staff.db.from("branches").update({ timezone: "Europe/Madrid" }).eq("id", local.branch).select("id");
    expect(staffDirecto.data ?? []).toEqual([]);
    const anon = await anonClient().from("branches").update({ timezone: "Europe/Madrid" }).eq("id", local.branch).select("id");
    expect(anon.data ?? []).toEqual([]);

    expect(await setBranchTimeZone(owner.db, ajena.id, local.branch, "Europe/Madrid")).toEqual({ ok: false, error: "not_found" });
    expect(await setBranchTimeZone(staff.db, local.id, local.branch, "Europe/Madrid")).toEqual({ ok: false, error: "forbidden" });
    expect((await setBranchTimeZone(stranger.db, local.id, local.branch, "Europe/Madrid")).ok).toBe(false);
    expect(await guardada(local.branch)).toBe(DEFAULT_BRANCH_TIME_ZONE);
    expect(await guardada(ajena.branch)).toBe(DEFAULT_BRANCH_TIME_ZONE);
  });

  it("con la cuenta en solo lectura o suspendida, ni el Dueño la cambia", async () => {
    for (const [finEnMs, error] of [
      [-10 * DIA_MS, "blocked_read_only"],
      [-20 * DIA_MS, "blocked_suspended"],
    ] as const) {
      const local = await nuevoLocal();
      await setSubscription(service, local.id, { finEnMs });
      expect(await setBranchTimeZone(owner.db, local.id, local.branch, "Europe/Madrid")).toEqual({ ok: false, error });
      expect(await guardada(local.branch)).toBe(DEFAULT_BRANCH_TIME_ZONE);
    }
  });
});

describe("quién la lee y qué no cambia", () => {
  const lecturaAnon = async (branchId: string) => (await anonClient().from("branches").select("timezone").eq("id", branchId)).data ?? [];

  it("la carta pública la lee mientras la sucursal esté activa y publicada", async () => {
    const local = await nuevoLocal();
    await service.from("branches").update({ timezone: "America/Lima" }).eq("id", local.branch);
    expect(await lecturaAnon(local.branch)).toEqual([{ timezone: "America/Lima" }]);

    await service.from("branches").update({ is_active: false }).eq("id", local.branch);
    expect(await lecturaAnon(local.branch)).toEqual([]);
    await service.from("branches").update({ is_active: true }).eq("id", local.branch);
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS }); // suspendida: la carta no se publica
    expect(await lecturaAnon(local.branch)).toEqual([]);
  });

  it("la facturación y la mora no dependen de la zona de la sucursal: el estado de la cuenta es el mismo con cualquier zona", async () => {
    const local = await nuevoLocal();
    const estado = async () => (await owner.db.rpc("org_entitlements", { p_org: local.id })).data;
    const antes = await estado();
    for (const zona of ["Europe/Madrid", "America/Los_Angeles", "America/Lima"]) {
      await service.from("branches").update({ timezone: zona }).eq("id", local.branch);
      expect(await estado(), zona).toEqual(antes);
    }
  });
});
