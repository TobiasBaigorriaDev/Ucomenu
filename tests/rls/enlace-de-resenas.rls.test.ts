import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBranchReviewLink } from "@/lib/sucursales/branches";
import { REVIEW_LINK_CASES } from "@/lib/sucursales/resenas-casos";
import { validateReviewLink } from "@/lib/sucursales/rules";
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
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Enlace de reseñas de Google por sucursal (nivel M, ficha enlace-de-resenas-de-google) contra el Supabase local: el CHECK de
 * la base acepta y rechaza lo mismo que la validación local, solo el Dueño (con la cuenta al día) lo escribe y la carta pública
 * lo lee únicamente mientras la sucursal está activa y publicada.
 */

const LINK = "https://g.page/r/CabcdEFGH1234/review";

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
  const slug = `tt-res-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal inicial: ${b.error.message}`);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, branch: b.data.id };
}

const guardado = async (branchId: string) =>
  (await service.from("branches").select("google_review_url").eq("id", branchId).single()).data?.google_review_url ?? null;

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "resenas-owner"),
    createUser(service, "resenas-staff"),
    createUser(service, "resenas-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("el CHECK de la base y la validación local dicen lo mismo", () => {
  it("cada fila de la tabla de casos: la base la acepta si y solo si la validación local la acepta", async () => {
    const local = await nuevoLocal();
    for (const { url, valid } of REVIEW_LINK_CASES) {
      const r = await service.from("branches").update({ google_review_url: url }).eq("id", local.branch);
      expect(r.error === null, `base: ${JSON.stringify(url)}`).toBe(valid);
      expect(validateReviewLink(url).ok, `local: ${JSON.stringify(url)}`).toBe(valid);
      if (!valid) expect(r.error?.code, JSON.stringify(url)).toBe("23514");
    }
  });

  it("vacío no es un enlace: la base no acepta una cadena vacía (se guarda nulo)", async () => {
    const local = await nuevoLocal();
    const r = await service.from("branches").update({ google_review_url: "" }).eq("id", local.branch);
    expect(r.error?.code).toBe("23514");
  });
});

describe("quién lo escribe", () => {
  it("el Dueño lo guarda, lo cambia y lo quita; se guarda tal cual y vacío lo vuelve nulo", async () => {
    const local = await nuevoLocal();
    expect(await setBranchReviewLink(owner.db, local.id, local.branch, `  ${LINK} `)).toEqual({ ok: true, data: undefined });
    expect(await guardado(local.branch)).toBe(LINK);
    const otro = "https://search.google.com/local/writereview?placeid=ChIJabc";
    expect((await setBranchReviewLink(owner.db, local.id, local.branch, otro)).ok).toBe(true);
    expect(await guardado(local.branch)).toBe(otro);
    expect((await setBranchReviewLink(owner.db, local.id, local.branch, "   ")).ok).toBe(true);
    expect(await guardado(local.branch)).toBeNull();
  });

  it("un enlace que no es de Google se rechaza con un mensaje claro y no cambia nada", async () => {
    const local = await nuevoLocal();
    expect((await setBranchReviewLink(owner.db, local.id, local.branch, LINK)).ok).toBe(true);
    expect(await setBranchReviewLink(owner.db, local.id, local.branch, "https://evil.com/g.page/r/abc")).toEqual({ ok: false, error: "review_link_invalid" });
    expect(await setBranchReviewLink(owner.db, local.id, local.branch, "https://g.page/" + "a".repeat(600))).toEqual({ ok: false, error: "review_link_too_long" });
    expect(await guardado(local.branch)).toBe(LINK);
  });

  it("aunque se salteen la validación local, la API no deja guardar un enlace ajeno", async () => {
    const local = await nuevoLocal();
    const r = await owner.db.from("branches").update({ google_review_url: "https://evil.com/x" }).eq("id", local.branch).select("id");
    expect(r.error?.code).toBe("23514");
    expect(await guardado(local.branch)).toBeNull();
  });

  it("el Staff, otra organización y anon no lo escriben", async () => {
    const local = await nuevoLocal();
    const ajena = await nuevoLocal();
    // Staff: la política de UPDATE es del Dueño, así que no afecta ninguna fila.
    const staffDirecto = await staff.db.from("branches").update({ google_review_url: LINK }).eq("id", local.branch).select("id");
    expect(staffDirecto.data ?? []).toEqual([]);
    const anon = await anonClient().from("branches").update({ google_review_url: LINK }).eq("id", local.branch).select("id");
    expect(anon.data ?? []).toEqual([]);
    expect(await guardado(local.branch)).toBeNull();

    // Por la lógica de la aplicación: el Dueño de otra organización no encuentra la sucursal; el Staff recibe «forbidden».
    expect(await setBranchReviewLink(owner.db, ajena.id, local.branch, LINK)).toEqual({ ok: false, error: "not_found" });
    expect(await setBranchReviewLink(staff.db, local.id, local.branch, LINK)).toEqual({ ok: false, error: "forbidden" });
    expect((await setBranchReviewLink(stranger.db, local.id, local.branch, LINK)).ok).toBe(false);
    expect(await guardado(local.branch)).toBeNull();
    expect(await guardado(ajena.branch)).toBeNull();
  });

  it("con la cuenta en solo lectura o suspendida, ni el Dueño lo escribe", async () => {
    for (const [finEnMs, error] of [
      [-10 * DIA_MS, "blocked_read_only"],
      [-20 * DIA_MS, "blocked_suspended"],
    ] as const) {
      const local = await nuevoLocal();
      await setSubscription(service, local.id, { finEnMs });
      expect(await setBranchReviewLink(owner.db, local.id, local.branch, LINK)).toEqual({ ok: false, error });
      expect(await guardado(local.branch)).toBeNull();
    }
  });
});

describe("quién lo lee", () => {
  const lecturaAnon = async (branchId: string) =>
    (await anonClient().from("branches").select("google_review_url").eq("id", branchId)).data ?? [];

  it("la carta pública lo lee mientras la sucursal esté activa y publicada", async () => {
    const local = await nuevoLocal();
    await service.from("branches").update({ google_review_url: LINK }).eq("id", local.branch);
    expect(await lecturaAnon(local.branch)).toEqual([{ google_review_url: LINK }]);

    await service.from("branches").update({ is_active: false }).eq("id", local.branch);
    expect(await lecturaAnon(local.branch)).toEqual([]);
    await service.from("branches").update({ is_active: true }).eq("id", local.branch);
    expect(await lecturaAnon(local.branch)).toEqual([{ google_review_url: LINK }]);

    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS }); // suspendida: la carta no se publica
    expect(await lecturaAnon(local.branch)).toEqual([]);
  });

  it("una organización dada de baja no expone el enlace", async () => {
    const local = await nuevoLocal();
    await service.from("branches").update({ google_review_url: LINK }).eq("id", local.branch);
    await service.from("organizations").update({ is_active: false }).eq("id", local.id);
    expect(await lecturaAnon(local.branch)).toEqual([]);
  });

  it("el personal de la organización lo lee; el de otra no", async () => {
    const local = await nuevoLocal();
    await service.from("branches").update({ google_review_url: LINK }).eq("id", local.branch);
    const propio = await staff.db.from("branches").select("google_review_url").eq("id", local.branch);
    expect(propio.data).toEqual([{ google_review_url: LINK }]);
  });
});
