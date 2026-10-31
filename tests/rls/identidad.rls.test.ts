import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AMBIENT_KEYS } from "@/lib/identidad/ambientes";
import { DENSITY_KEYS, SHAPE_KEYS } from "@/lib/identidad/formas";
import { loadIdentity, removeCover, removeLogo, setAmbient, setCover, setFont, setLayout, setLogo, setPalette, setShape, setStyle, setTheme, setVoice } from "@/lib/identidad/identity";
import { LOGO_BUCKET } from "@/lib/identidad/logos";
import { LAYOUT_KEYS } from "@/lib/identidad/layouts";
import { PALETTE_KEYS } from "@/lib/identidad/palettes";
import { THEME_KEYS } from "@/lib/identidad/temas";
import { LOOK_KEYS, lookStyle } from "@/lib/identidad/looks";
import { FONT_KEYS } from "@/lib/identidad/tipografias";
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
    expect(await loadIdentity(owner.db, org)).toEqual({ menu_palette: "oliva", menu_layout: "bento", menu_theme: "ninguno", menu_theme_from: null, menu_theme_until: null, logo_path: null, menu_font: "clasica", menu_shape: "suave", menu_density: "aireada", menu_ambient: "ninguno", menu_tagline: null, opening_hours: null, instagram_handle: null, whatsapp_number: null, cover_path: null });
    // Cada paleta que ofrece la aplicación la acepta la base (el `check` de la migración y `PALETTES` van de la mano).
    for (const key of PALETTE_KEYS) {
      expect(await setPalette(owner.db, org, key)).toEqual({ ok: true });
      expect((await loadIdentity(owner.db, org)).menu_palette).toBe(key);
    }
    expect(await setPalette(owner.db, org, "vino")).toEqual({ ok: true });
    expect((await loadIdentity(owner.db, org)).menu_palette).toBe("vino");
    expect((await loadIdentity(service, other)).menu_palette).toBe("oliva");
    expect(await setPalette(owner.db, org, "__proto__")).toEqual({ ok: false, error: "palette_invalid" });
    for (const key of LAYOUT_KEYS) {
      expect(await setLayout(owner.db, org, key)).toEqual({ ok: true });
      expect((await loadIdentity(owner.db, org)).menu_layout).toBe(key);
    }
    expect(await setLayout(owner.db, org, "bento")).toEqual({ ok: true });
    expect((await loadIdentity(service, other)).menu_layout).toBe("bento");
    expect(await setLayout(owner.db, org, "__proto__")).toEqual({ ok: false, error: "layout_invalid" });

    // Temas de fecha especial: cada uno se guarda con su ventana; «ninguno» borra las fechas; la base rechaza lo inválido.
    for (const key of THEME_KEYS) {
      expect(await setTheme(owner.db, org, key, "2026-12-20", "2026-12-26")).toEqual({ ok: true });
      expect(await loadIdentity(owner.db, org)).toMatchObject({ menu_theme: key, menu_theme_from: "2026-12-20", menu_theme_until: "2026-12-26" });
    }
    expect(await setTheme(owner.db, org, "navidad", "", "2026-12-26")).toEqual({ ok: true }); // solo «hasta»
    expect(await loadIdentity(owner.db, org)).toMatchObject({ menu_theme_from: null, menu_theme_until: "2026-12-26" });
    expect(await setTheme(owner.db, org, "ninguno", "2026-12-20", "2026-12-26")).toEqual({ ok: true });
    expect(await loadIdentity(owner.db, org)).toMatchObject({ menu_theme: "ninguno", menu_theme_from: null, menu_theme_until: null });
    expect((await loadIdentity(service, other)).menu_theme).toBe("ninguno");
    expect(await setTheme(owner.db, org, "__proto__", null, null)).toEqual({ ok: false, error: "theme_invalid" });
    expect(await setTheme(owner.db, org, "navidad", "2026-12-26", "2026-12-20")).toEqual({ ok: false, error: "theme_dates_invalid" });
    expect(await setTheme(owner.db, org, "navidad", "2026-02-30", null)).toEqual({ ok: false, error: "theme_dates_invalid" });
    const sinApp = (patch: { menu_theme?: string; menu_theme_from?: string; menu_theme_until?: string }) => owner.db.from("organizations").update(patch).eq("id", org);
    expect((await sinApp({ menu_theme: "libre" })).error?.code).toBe("23514");
    expect((await sinApp({ menu_theme_from: "2026-12-26", menu_theme_until: "2026-12-20" })).error?.code).toBe("23514");
    expect((await owner.db.from("organizations").update({ menu_layout: "libre" }).eq("id", org)).error?.code).toBe("23514");
    expect((await owner.db.from("organizations").update({ menu_palette: "libre" }).eq("id", org)).error?.code).toBe("23514");
  });

  it("guardar el estilo escribe las seis opciones juntas (o ninguna): cada look se acepta y lo inválido no cambia nada", async () => {
    for (const key of LOOK_KEYS) {
      const look = lookStyle(key);
      expect(await setStyle(owner.db, org, look), key).toEqual({ ok: true });
      expect(await loadIdentity(owner.db, org)).toMatchObject({
        menu_palette: look.palette, menu_layout: look.layout, menu_font: look.font, menu_shape: look.shape, menu_density: look.density, menu_ambient: look.ambient,
      });
    }
    const vigente = await loadIdentity(owner.db, org);
    const bueno = lookStyle("brunch");
    for (const [campo, error] of [["palette", "palette_invalid"], ["layout", "layout_invalid"], ["font", "font_invalid"], ["shape", "shape_invalid"], ["density", "density_invalid"], ["ambient", "ambient_invalid"]] as const) {
      expect(await setStyle(owner.db, org, { ...bueno, [campo]: "__proto__" }), campo).toEqual({ ok: false, error });
    }
    expect(await loadIdentity(owner.db, org)).toEqual(vigente); // un valor inválido no deja la mitad escrita
    for (const db of [staff.db, stranger.db]) expect((await setStyle(db, org, bueno)).ok).toBe(false);
    expect((await setStyle(owner.db, other, bueno)).ok).toBe(false);
    expect(await loadIdentity(owner.db, org)).toEqual(vigente);
    expect(await loadIdentity(service, other)).toMatchObject({ menu_palette: "oliva", menu_layout: "bento", menu_font: "clasica" });
    // Se deja el estilo como lo esperan las pruebas siguientes.
    expect(await setStyle(owner.db, org, { palette: "vino", layout: "bento", font: "clasica", shape: "suave", density: "aireada", ambient: "ninguno" })).toEqual({ ok: true });
  });

  it("tipografía, forma, densidad y ambientación: cada opción se guarda, lo inválido se rechaza y nada se filtra a otro local", async () => {
    for (const key of FONT_KEYS) {
      expect(await setFont(owner.db, org, key)).toEqual({ ok: true });
      expect((await loadIdentity(owner.db, org)).menu_font).toBe(key);
    }
    for (const shape of SHAPE_KEYS) for (const density of DENSITY_KEYS) {
      expect(await setShape(owner.db, org, shape, density)).toEqual({ ok: true });
      expect(await loadIdentity(owner.db, org)).toMatchObject({ menu_shape: shape, menu_density: density });
    }
    for (const key of AMBIENT_KEYS) {
      expect(await setAmbient(owner.db, org, key)).toEqual({ ok: true });
      expect((await loadIdentity(owner.db, org)).menu_ambient).toBe(key);
    }
    const last = { font: FONT_KEYS.at(-1), shape: SHAPE_KEYS.at(-1), density: DENSITY_KEYS.at(-1), ambient: AMBIENT_KEYS.at(-1) };
    expect(await setFont(owner.db, org, "__proto__")).toEqual({ ok: false, error: "font_invalid" });
    expect(await setShape(owner.db, org, "redonda", "aireada")).toEqual({ ok: false, error: "shape_invalid" });
    expect(await setShape(owner.db, org, "suave", "apretada")).toEqual({ ok: false, error: "density_invalid" });
    expect(await setAmbient(owner.db, org, "disco")).toEqual({ ok: false, error: "ambient_invalid" });
    // La base también los rechaza sin pasar por la aplicación.
    for (const patch of [{ menu_font: "libre" }, { menu_shape: "libre" }, { menu_density: "libre" }, { menu_ambient: "libre" }]) {
      expect((await owner.db.from("organizations").update(patch).eq("id", org)).error?.code, JSON.stringify(patch)).toBe("23514");
    }
    expect(await loadIdentity(service, other)).toMatchObject({ menu_font: "clasica", menu_shape: "suave", menu_density: "aireada", menu_ambient: "ninguno" });
    // Staff, ajeno y anónimo no los cambian.
    for (const db of [staff.db, stranger.db]) {
      expect((await setFont(db, org, "clasica")).ok).toBe(false);
      expect((await setShape(db, org, "suave", "aireada")).ok).toBe(false);
      expect((await setAmbient(db, org, "ninguno")).ok).toBe(false);
    }
    for (const patch of [{ menu_font: "clasica" }, { menu_shape: "suave" }, { menu_density: "aireada" }, { menu_ambient: "ninguno" }]) {
      expect((await anonClient().from("organizations").update(patch).eq("id", org)).error?.code, JSON.stringify(patch)).toBe("42501");
    }
    expect(await loadIdentity(service, org)).toMatchObject({ menu_font: last.font, menu_shape: last.shape, menu_density: last.density, menu_ambient: last.ambient });
  });

  it("voz del local: el Dueño guarda lema, horarios, Instagram y WhatsApp; la base solo guarda identificadores", async () => {
    expect(await setVoice(owner.db, org, { tagline: "  Café de especialidad  ", hours: "Lun a sáb de 8 a 20 hs", instagram: "https://www.instagram.com/milocal/", whatsapp: "+54 9 11 1234-5678" })).toEqual({ ok: true });
    expect(await loadIdentity(owner.db, org)).toMatchObject({ menu_tagline: "Café de especialidad", opening_hours: "Lun a sáb de 8 a 20 hs", instagram_handle: "milocal", whatsapp_number: "5491112345678" });
    // Cualquiera que abra la carta lee estos datos con la clave pública.
    const publicRow = await anonClient().from("organizations").select("menu_tagline, opening_hours, instagram_handle, whatsapp_number").eq("id", org).single();
    expect(publicRow.data).toEqual({ menu_tagline: "Café de especialidad", opening_hours: "Lun a sáb de 8 a 20 hs", instagram_handle: "milocal", whatsapp_number: "5491112345678" });
    // Entradas inválidas: la aplicación las rechaza antes de escribir.
    expect(await setVoice(owner.db, org, { tagline: "a\nb", hours: "", instagram: "", whatsapp: "" })).toEqual({ ok: false, error: "tagline_invalid" });
    expect(await setVoice(owner.db, org, { tagline: "x".repeat(81), hours: "", instagram: "", whatsapp: "" })).toEqual({ ok: false, error: "tagline_too_long" });
    expect(await setVoice(owner.db, org, { tagline: "", hours: "", instagram: "https://evil.example/x", whatsapp: "" })).toEqual({ ok: false, error: "instagram_invalid" });
    expect(await setVoice(owner.db, org, { tagline: "", hours: "", instagram: "", whatsapp: "wa.me/123" })).toEqual({ ok: false, error: "whatsapp_invalid" });
    // ...y la base las rechaza si alguien escribe sin pasar por la aplicación (espejo de las reglas de `voz.ts`).
    const raw = (patch: Partial<Record<"menu_tagline" | "opening_hours" | "instagram_handle" | "whatsapp_number", string>>) => owner.db.from("organizations").update(patch).eq("id", org);
    for (const patch of [
      { menu_tagline: "" }, { menu_tagline: "x".repeat(81) }, { menu_tagline: "a\nb" }, { menu_tagline: "a‮b" }, { menu_tagline: "a​b" },
      { opening_hours: "" }, { opening_hours: "x".repeat(161) }, { opening_hours: "a\tb" },
      { instagram_handle: "https://evil.example" }, { instagram_handle: "mi local" }, { instagram_handle: "a".repeat(31) }, { instagram_handle: "@milocal" },
      { whatsapp_number: "+5491112345678" }, { whatsapp_number: "1234567" }, { whatsapp_number: "1".repeat(16) }, { whatsapp_number: "wa.me/54911" },
    ]) expect((await raw(patch)).error?.code, JSON.stringify(patch)).toBe("23514");
    expect((await raw({ menu_tagline: "x".repeat(80), opening_hours: "x".repeat(160), instagram_handle: "a".repeat(30), whatsapp_number: "1".repeat(15) })).error).toBeNull();
    // Vacío = quitar.
    expect(await setVoice(owner.db, org, { tagline: "", hours: "", instagram: "", whatsapp: "" })).toEqual({ ok: true });
    expect(await loadIdentity(owner.db, org)).toMatchObject({ menu_tagline: null, opening_hours: null, instagram_handle: null, whatsapp_number: null });
    // Otro local intacto; Staff, ajeno y anónimo no escriben.
    expect(await loadIdentity(service, other)).toMatchObject({ menu_tagline: null, instagram_handle: null });
    for (const db of [staff.db, stranger.db]) expect((await setVoice(db, org, { tagline: "Intruso", hours: "", instagram: "", whatsapp: "" })).ok).toBe(false);
    expect((await anonClient().from("organizations").update({ menu_tagline: "Intruso" }).eq("id", org)).error?.code).toBe("42501");
    expect((await owner.db.from("organizations").update({ menu_tagline: "Intruso" }).eq("id", other).select("id")).data).toEqual([]);
    expect((await loadIdentity(service, org)).menu_tagline).toBeNull();
  });

  it("portada: el Dueño sube, reemplaza y quita la foto; el logo vive aparte y nada cruza entre locales", async () => {
    expect(await setLogo(owner.db, org, file())).toEqual({ ok: true, filesComplete: true });
    const logo = (await loadIdentity(owner.db, org)).logo_path!;
    expect(await setCover(owner.db, org, file())).toEqual({ ok: true, filesComplete: true });
    const first = (await loadIdentity(owner.db, org)).cover_path!;
    expect(first).toMatch(new RegExp(`^${org}/[0-9a-f-]{36}\\.png$`));
    expect(first).not.toBe(logo);
    expect(await exists(first)).toBe(true);
    // Reemplazar la portada borra la portada saliente y NO toca el logo.
    expect(await setCover(owner.db, org, file())).toEqual({ ok: true, filesComplete: true });
    const second = (await loadIdentity(owner.db, org)).cover_path!;
    expect(second).not.toBe(first);
    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(true);
    expect(await exists(logo)).toBe(true);
    expect((await loadIdentity(owner.db, org)).logo_path).toBe(logo);
    // La base impide que portada y logo sean el mismo archivo (el reemplazo borraría el vigente de la otra).
    expect((await owner.db.from("organizations").update({ cover_path: logo }).eq("id", org)).error?.code).toBe("23514");
    expect((await owner.db.from("organizations").update({ logo_path: second }).eq("id", org)).error?.code).toBe("23514");
    // Rutas ajenas o de forma no permitida.
    for (const path of [pathFor(other), `${org}/portada.svg`, `${org}/../x.png`, `${org}/x/${crypto.randomUUID()}.png`]) {
      expect((await owner.db.from("organizations").update({ cover_path: path }).eq("id", org)).error?.code, path).toBe("23514");
    }
    // Quitar la portada borra su archivo y deja el logo.
    expect(await removeCover(owner.db, org)).toEqual({ ok: true, filesComplete: true });
    expect((await loadIdentity(owner.db, org)).cover_path).toBeNull();
    expect(await exists(second)).toBe(false);
    expect(await exists(logo)).toBe(true);
    expect(await removeLogo(owner.db, org)).toEqual({ ok: true, filesComplete: true });
    // Formato y tamaño inválidos se rechazan antes de subir nada.
    expect(await setCover(owner.db, org, null)).toEqual({ ok: false, error: "image_missing" });
    expect(await setCover(owner.db, org, new File([new Uint8Array(3 * 1024 * 1024)], "grande.png", { type: "image/png" }))).toEqual({ ok: false, error: "image_big" });
    expect(await setCover(owner.db, org, new File([Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")], "x.svg", { type: "image/svg+xml" }))).toEqual({ ok: false, error: "image_type" });
    expect((await loadIdentity(service, other)).cover_path).toBeNull();
  });

  it("portada: Staff, ajeno y anónimo no la cambian ni la quitan, ni llaman a la función de reemplazo", async () => {
    expect(await setCover(owner.db, org, file())).toEqual({ ok: true, filesComplete: true });
    const saved = (await loadIdentity(owner.db, org)).cover_path!;
    for (const db of [staff.db, stranger.db]) {
      expect((await setCover(db, org, file())).ok).toBe(false);
      expect((await removeCover(db, org)).ok).toBe(false);
      const direct = await db.from("organizations").update({ cover_path: pathFor() }).eq("id", org).select("id");
      expect(direct.data ?? []).toEqual([]);
    }
    // El Dueño de otro local tampoco puede tocar la de este.
    expect((await removeCover(owner.db, other)).ok).toBe(false);
    expect((await anonClient().from("organizations").update({ cover_path: pathFor() }).eq("id", org)).error?.code).toBe("42501");
    expect((await anonClient().rpc("replace_organization_cover", { p_org: org, p_path: null as unknown as string })).error).not.toBeNull();
    expect((await loadIdentity(service, org)).cover_path).toBe(saved);
    expect(await exists(saved)).toBe(true);
    expect(await removeCover(owner.db, org)).toEqual({ ok: true, filesComplete: true });
  });

  it("Staff, ajeno y anónimo no modifican columnas; manipular otro local tampoco funciona", async () => {
    for (const db of [staff.db, stranger.db, owner.db]) {
      const id = db === owner.db ? other : org;
      const result = await db.from("organizations").update({ menu_palette: "azul", logo_path: pathFor(id) }).eq("id", id).select("id");
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
      expect((await setPalette(db, id, "azul")).ok).toBe(false);
      expect((await setLayout(db, id, "minimal")).ok).toBe(false);
      expect((await setTheme(db, id, "navidad", null, null)).ok).toBe(false);
      expect((await removeLogo(db, id)).ok).toBe(false);
    }
    expect((await anonClient().from("organizations").update({ menu_palette: "azul" }).eq("id", org)).error?.code).toBe("42501");
    expect((await anonClient().from("organizations").update({ menu_layout: "minimal" }).eq("id", org)).error?.code).toBe("42501");
    expect((await anonClient().from("organizations").update({ menu_theme: "navidad" }).eq("id", org)).error?.code).toBe("42501");
    expect((await loadIdentity(service, org)).menu_theme).toBe("ninguno");
    expect((await loadIdentity(service, org)).menu_layout).toBe("bento");
    expect((await loadIdentity(service, org)).menu_palette).toBe("vino");
  });

  it("la base rechaza rutas ajenas o de forma no permitida", async () => {
    for (const path of [pathFor(other), `${org}/logo.svg`, `${org}/../logo.png`]) {
      const result = await owner.db.from("organizations").update({ logo_path: path }).eq("id", org);
      expect(result.error?.code).toBe("23514");
    }
  });

  it("sube, reemplaza y quita el logo con la sesión del Dueño, limpiando la versión anterior", async () => {
    expect(await setLogo(owner.db, org, file())).toEqual({ ok: true, filesComplete: true });
    const first = (await loadIdentity(owner.db, org)).logo_path!;
    expect(await exists(first)).toBe(true);
    expect(await setLogo(owner.db, org, file())).toEqual({ ok: true, filesComplete: true });
    const second = (await loadIdentity(owner.db, org)).logo_path!;
    expect(second).not.toBe(first);
    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(true);
    expect(await removeLogo(owner.db, org)).toEqual({ ok: true, filesComplete: true });
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
    expect(await setLogo(owner.db, org, file())).toEqual({ ok: true, filesComplete: true });
    const previous = await loadIdentity(owner.db, org);
    const uploaded: string[] = [];
    const failing = new Proxy(owner.db, {
      get(target, prop, receiver) {
        // La base rechaza la ruta (viola el check de `logo_path`) y revierte: la referencia no cambia.
        if (prop === "rpc") return (fn: string, args: { p_org: string; p_path: string }) =>
          target.rpc(fn as "replace_organization_logo", fn === "replace_organization_logo" ? { ...args, p_path: `${args.p_org}/no-es-uuid.png` } : args);
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
      expect(await removeLogo(db, org)).toEqual({ ok: true, filesComplete: false });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("cero archivos eliminados"));
    } finally { log.mockRestore(); }
  });
});
