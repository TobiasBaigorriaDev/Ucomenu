import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadIdentity, removeLogo, setLogo, setPalette } from "@/lib/identidad/identity";
import { LOGO_BUCKET } from "@/lib/identidad/logos";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, serviceClient, setSubscription, type Db, type TestUser } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const file = () => new File([PNG], "logo.png", { type: "image/png" });
let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
let org: string;
let other: string;
const objects: string[] = [];

const pathFor = (id = org) => `${id}/${crypto.randomUUID()}.png`;
const exists = async (path: string) => {
  const [prefix, name] = path.split("/");
  const list = await service.storage.from(LOGO_BUCKET).list(prefix);
  expect(list.error).toBeNull();
  return list.data?.some(object => object.name === name);
};

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([createUser(service, "marca-owner"), createUser(service, "marca-staff"), createUser(service, "marca-ajeno")]);
  org = await createOrg(service, "tt-identidad");
  other = await createOrg(service, "tt-identidad-otra");
  await addMembership(service, owner, org, "owner");
  await addMembership(service, staff, org, "staff");
});

afterAll(async () => {
  // Se recogen también subidas de una prueba interrumpida y archivos huérfanos.
  if (service) {
    for (const id of [org, other].filter(Boolean)) {
      const list = await service.storage.from(LOGO_BUCKET).list(id);
      objects.push(...(list.data ?? []).map(object => `${id}/${object.name}`));
    }
    if (objects.length) await service.storage.from(LOGO_BUCKET).remove([...new Set(objects)]);
    await deleteOrg(service, org);
    await deleteOrg(service, other);
    await Promise.all([owner, staff, stranger].map(person => deleteUser(service, person)));
  }
});

describe("identidad por organización", () => {
  it("conserva el predeterminado y permite al Dueño guardar colores sin afectar otro local", async () => {
    expect(await loadIdentity(owner.db, org)).toEqual({ menu_palette: "oliva", logo_path: null });
    expect(await setPalette(owner.db, org, "vino")).toEqual({ ok: true });
    expect((await loadIdentity(owner.db, org)).menu_palette).toBe("vino");
    expect((await loadIdentity(service, other)).menu_palette).toBe("oliva");
    expect(await setPalette(owner.db, org, "__proto__")).toEqual({ ok: false, error: "palette_invalid" });
    expect((await owner.db.from("organizations").update({ menu_palette: "libre" }).eq("id", org)).error?.code).toBe("23514");
  });

  it("Staff, ajeno y anónimo no modifican columnas; manipular otro local tampoco funciona", async () => {
    for (const db of [staff.db, stranger.db, owner.db]) {
      const id = db === owner.db ? other : org;
      const result = await db.from("organizations").update({ menu_palette: "azul", logo_path: pathFor(id) }).eq("id", id).select("id");
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
      expect((await setPalette(db, id, "azul")).ok).toBe(false);
      expect((await removeLogo(db, id)).ok).toBe(false);
    }
    expect((await anonClient().from("organizations").update({ menu_palette: "azul" }).eq("id", org)).error?.code).toBe("42501");
    expect((await loadIdentity(service, org)).menu_palette).toBe("vino");
  });

  it("la base rechaza rutas ajenas o de forma no permitida", async () => {
    for (const path of [pathFor(other), `${org}/logo.svg`, `${org}/../logo.png`]) {
      const result = await owner.db.from("organizations").update({ logo_path: path }).eq("id", org);
      expect(result.error?.code).toBe("23514");
    }
  });

  it("sube, reemplaza y quita el logo con la sesión del Dueño, limpiando la versión anterior", async () => {
    expect(await setLogo(owner.db, org, file())).toEqual({ ok: true });
    const first = (await loadIdentity(owner.db, org)).logo_path!;
    expect(await exists(first)).toBe(true);
    expect(await setLogo(owner.db, org, file())).toEqual({ ok: true });
    const second = (await loadIdentity(owner.db, org)).logo_path!;
    expect(second).not.toBe(first);
    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(true);
    expect(await removeLogo(owner.db, org)).toEqual({ ok: true });
    expect((await loadIdentity(owner.db, org)).logo_path).toBeNull();
    expect(await exists(second)).toBe(false);
  });

  it("Storage bloquea subidas y borrados de Staff, ajenos y anónimos; también rutas inválidas", async () => {
    const saved = pathFor();
    objects.push(saved);
    expect((await owner.db.storage.from(LOGO_BUCKET).upload(saved, PNG, { contentType: "image/png" })).error).toBeNull();
    for (const db of [staff.db, stranger.db, anonClient()]) {
      expect((await db.storage.from(LOGO_BUCKET).upload(pathFor(), PNG, { contentType: "image/png" })).error).not.toBeNull();
      const removed = await db.storage.from(LOGO_BUCKET).remove([saved]);
      expect(removed.data ?? []).toEqual([]);
      expect(await exists(saved)).toBe(true);
    }
    for (const path of [pathFor(other), `${org}/logo.png`, `${org}/mal/${crypto.randomUUID()}.png`]) {
      expect((await owner.db.storage.from(LOGO_BUCKET).upload(path, PNG, { contentType: "image/png" })).error).not.toBeNull();
    }
    // Un recurso gráfico público puede descargarse sin sesión, como las fotos de platos.
    const publicUrl = service.storage.from(LOGO_BUCKET).getPublicUrl(saved).data.publicUrl;
    expect((await fetch(publicUrl)).status).toBe(200);
  });

  it.each([10, 20])("la cuenta bloqueada (%i días) impide columnas, subida y borrado aunque se fuerce la API", async days => {
    const saved = pathFor();
    objects.push(saved);
    expect((await owner.db.storage.from(LOGO_BUCKET).upload(saved, PNG, { contentType: "image/png" })).error).toBeNull();
    await setSubscription(service, org, { finEnMs: -days * DIA_MS });
    try {
      expect((await setPalette(owner.db, org, "cacao")).ok).toBe(false);
      expect((await setLogo(owner.db, org, file())).ok).toBe(false);
      expect((await removeLogo(owner.db, org)).ok).toBe(false);
      const forced = await owner.db.from("organizations").update({ menu_palette: "cacao", logo_path: null }).eq("id", org).select("id");
      expect(forced.error).toBeNull();
      expect(forced.data).toEqual([]);
      expect((await owner.db.storage.from(LOGO_BUCKET).upload(pathFor(), PNG, { contentType: "image/png" })).error).not.toBeNull();
      expect((await owner.db.storage.from(LOGO_BUCKET).remove([saved])).data).toEqual([]);
      expect(await exists(saved)).toBe(true);
    } finally {
      await setSubscription(service, org, { finEnMs: 5 * DIA_MS });
    }
  });

  it("rechaza un archivo vacío, grande o con tipo fingido sin modificar el logo", async () => {
    expect(await setLogo(owner.db, org, null)).toEqual({ ok: false, error: "image_missing" });
    expect(await setLogo(owner.db, org, new File([Buffer.alloc(2 * 1024 * 1024 + 1)], "grande.png"))).toEqual({ ok: false, error: "image_big" });
    expect(await setLogo(owner.db, org, new File(["<svg></svg>"], "falso.png", { type: "image/png" }))).toEqual({ ok: false, error: "image_type" });
  });

  it("si falla apuntar a la subida nueva, la retira y conserva el logo anterior", async () => {
    expect(await setLogo(owner.db, org, file())).toEqual({ ok: true });
    const previous = await loadIdentity(owner.db, org);
    const uploaded: string[] = [];
    const failing = new Proxy(owner.db, {
      get(target, prop, receiver) {
        if (prop === "from") return (table: string) => {
          const builder = target.from(table as "organizations");
          return new Proxy(builder, {
            get(t, p, r) {
              if (p === "update") return () => t.update({ menu_palette: "inválida" });
              return Reflect.get(t, p, r);
            },
          });
        };
        if (prop === "storage") return {
          from: (bucket: string) => {
            const real = target.storage.from(bucket);
            return {
              upload: (path: string, bytes: Uint8Array, options: object) => { uploaded.push(path); return real.upload(path, bytes, options); },
              remove: real.remove.bind(real),
            };
          },
        };
        return Reflect.get(target, prop, receiver);
      },
    });
    expect((await setLogo(failing, org, file())).ok).toBe(false);
    expect(uploaded).toHaveLength(1);
    expect(await exists(uploaded[0])).toBe(false);
    expect(await loadIdentity(owner.db, org)).toEqual(previous);
  });

  it("una limpieza descartada por RLS se registra y no borra fuera de la carpeta", async () => {
    const db = new Proxy(owner.db, {
      get(target, prop, receiver) {
        if (prop === "storage") return {
          from: (bucket: string) => {
            const real = target.storage.from(bucket);
            return { upload: real.upload.bind(real), remove: async () => ({ data: [], error: null }) };
          },
        };
        return Reflect.get(target, prop, receiver);
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await removeLogo(db, org)).toEqual({ ok: true });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("cero archivos eliminados"));
    } finally { log.mockRestore(); }
  });
});
