import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCategory, createProduct, loadProduct, removeProductImage, setProductImage } from "@/lib/carta/catalog";
import { IMAGE_BUCKET } from "@/lib/carta/images";
import { loadIdentity, removeCover, removeLogo, setCover, setLogo } from "@/lib/identidad/identity";
import { LOGO_BUCKET } from "@/lib/identidad/logos";
import {
  addMembership,
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
 * Reemplazo de fotos y logos con subidas simultáneas (nivel C, ficha orden-e-imagenes-atomicos) contra el Supabase local.
 * El archivo saliente lo devuelve la base al bloquear la fila (`replace_product_image` / `replace_organization_logo`), así que
 * cada reemplazo borra exactamente lo que ÉL desplazó. Las intercalaciones son deterministas: un «gancho» deja pasar a la otra
 * operación justo entre dos pasos de la primera (después de subir, antes de apuntar; antes de quitar).
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
const png = () => new File([PNG], "foto.png", { type: "image/png" });

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let service: Db;
let owner: TestUser;
let staff: TestUser;
const orgs: string[] = [];
let contador = 0;

async function nuevaOrg() {
  contador += 1;
  const id = await createOrg(service, `tt-rim-${sufijo}-${contador}`, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 5 * DIA_MS });
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return id;
}

async function nuevoPlato() {
  const org = await nuevaOrg();
  const cat = await createCategory(owner.db, org, { name: "Carta" });
  if (!cat.ok) throw new Error("categoría");
  const plato = await createProduct(owner.db, org, { categoryId: cat.data.id, name: "Plato", description: "", price: "1", active: true });
  if (!plato.ok) throw new Error("plato");
  return { org, id: plato.data.id };
}

/** Archivos de la carpeta de un plato en Storage. */
async function archivosDelPlato(org: string, id: string) {
  const { data, error } = await service.storage.from(IMAGE_BUCKET).list(`${org}/${id}`);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((f) => f.id).map((f) => `${org}/${id}/${f.name}`).sort();
}
const rutaDelPlato = async (id: string) => (await service.from("products").select("image_path").eq("id", id).single()).data!.image_path;

async function archivosDelLogo(org: string) {
  const { data, error } = await service.storage.from(LOGO_BUCKET).list(org);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((f) => f.id).map((f) => `${org}/${f.name}`).sort();
}

type Ganchos = {
  /** Corre después de que `upload` terminó y antes de seguir con lo que sigue (apuntar el plato o el logo). */
  trasSubir?: () => Promise<void>;
  /** Corre antes de cada llamada a `rpc` con ese nombre. */
  antesDeRpc?: Record<string, () => Promise<void>>;
  /** Reemplaza la respuesta de una `rpc` (fallo de red simulado). */
  respuestaDeRpc?: Record<string, (real: () => PromiseLike<unknown>) => Promise<unknown>>;
  /** Respuesta de Storage al borrar; por defecto, la real. */
  borrar?: (real: () => Promise<{ data: unknown[] | null; error: { message: string } | null }>, ruta: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
};

/** El cliente de una persona con ganchos entre los pasos del módulo. */
function conGanchos(db: Db, g: Ganchos): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "rpc") {
        return async (fn: string, args: unknown) => {
          await g.antesDeRpc?.[fn]?.();
          const real = () => (target.rpc as (...a: unknown[]) => PromiseLike<unknown>)(fn, args);
          return g.respuestaDeRpc?.[fn] ? g.respuestaDeRpc[fn](real) : real();
        };
      }
      if (prop === "storage") {
        return {
          from: (bucket: string) => {
            const real = target.storage.from(bucket);
            return {
              upload: async (path: string, ...rest: unknown[]) => {
                const r = await (real.upload as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
                await g.trasSubir?.();
                return r;
              },
              remove: (paths: string[]) =>
                g.borrar ? g.borrar(() => real.remove(paths) as never, paths[0]) : real.remove(paths),
            };
          },
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff] = await Promise.all([createUser(service, "rim-owner"), createUser(service, "rim-staff")]);
});

afterAll(async () => {
  for (const org of orgs) {
    const { data: platos } = await service.from("products").select("id").eq("organization_id", org);
    for (const p of platos ?? []) {
      const rutas = await archivosDelPlato(org, p.id).catch(() => []);
      if (rutas.length) await service.storage.from(IMAGE_BUCKET).remove(rutas);
    }
    const logos = await archivosDelLogo(org).catch(() => []);
    if (logos.length) await service.storage.from(LOGO_BUCKET).remove(logos);
  }
  for (const id of orgs) await deleteOrg(service, id);
  await Promise.all([owner, staff].map((u) => deleteUser(service, u)));
});

describe("fotos de platos", () => {
  it("un reemplazo normal deja una sola foto: borra exactamente la que desplazó", async () => {
    const { org, id } = await nuevoPlato();
    expect(await setProductImage(owner.db, org, id, png())).toEqual({ ok: true, data: { filesComplete: true } });
    const primera = await rutaDelPlato(id);

    expect(await setProductImage(staff.db, org, id, png())).toEqual({ ok: true, data: { filesComplete: true } });

    const segunda = await rutaDelPlato(id);
    expect(segunda).not.toBe(primera);
    expect(await archivosDelPlato(org, id)).toEqual([segunda]);
  });

  it("dos reemplazos simultáneos no dejan huérfanos ni borran la foto vigente (la segunda sube mientras la primera ya subió)", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    const inicial = await rutaDelPlato(id);
    let resultadoB: Awaited<ReturnType<typeof setProductImage>> | undefined;
    // A sube, y ANTES de apuntar el plato entra B completo (sube, apunta y borra la inicial).
    const a = conGanchos(owner.db, {
      trasSubir: async () => {
        resultadoB = await setProductImage(staff.db, org, id, png());
      },
    });

    const resultadoA = await setProductImage(a, org, id, png());

    expect(resultadoA).toEqual({ ok: true, data: { filesComplete: true } });
    expect(resultadoB).toEqual({ ok: true, data: { filesComplete: true } });
    const vigente = await rutaDelPlato(id);
    expect(vigente).not.toBe(inicial);
    // Quedó UNA sola foto, la vigente: A (que apuntó última) borró la de B, que fue la que desplazó; B borró la inicial.
    expect(await archivosDelPlato(org, id)).toEqual([vigente]);
    // …y la vigente se descarga.
    expect((await service.storage.from(IMAGE_BUCKET).download(vigente!)).error).toBeNull();
  });

  it("dos reemplazos que corren de verdad a la vez terminan con una sola foto", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);

    const resultados = await Promise.all([
      setProductImage(owner.db, org, id, png()),
      setProductImage(staff.db, org, id, png()),
      setProductImage(owner.db, org, id, png()),
    ]);

    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(await archivosDelPlato(org, id)).toEqual([await rutaDelPlato(id)]);
  });

  it("no se borra «todo lo que no sea la vigente»: un archivo suelto de otra subida en curso queda", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    // Una subida ajena que todavía no apuntó el plato (la de otra pestaña que está a mitad de camino).
    const enCurso = `${org}/${id}/${crypto.randomUUID()}.png`;
    expect((await service.storage.from(IMAGE_BUCKET).upload(enCurso, PNG, { contentType: "image/png" })).error).toBeNull();

    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);

    const vigente = await rutaDelPlato(id);
    expect(await archivosDelPlato(org, id)).toEqual([enCurso, vigente].sort());
  });

  it("quitar la foto mientras otro la reemplaza: se borra la que de verdad estaba, no la que se leyó antes", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    let reemplazo: Awaited<ReturnType<typeof setProductImage>> | undefined;
    const quita = conGanchos(owner.db, {
      antesDeRpc: {
        replace_product_image: async () => {
          reemplazo = await setProductImage(staff.db, org, id, png()); // entra entre la lectura y la escritura de «quitar»
        },
      },
    });

    const r = await removeProductImage(quita, org, id);

    expect(r).toEqual({ ok: true, data: { filesComplete: true } });
    expect(reemplazo?.ok).toBe(true);
    expect(await rutaDelPlato(id)).toBeNull();
    expect(await archivosDelPlato(org, id)).toEqual([]); // ni la inicial ni la del reemplazo quedaron huérfanas
  });

  it("si la base rechaza apuntar a la foto nueva, se borra la recién subida y la anterior sigue", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    const anterior = await rutaDelPlato(id);
    const db = conGanchos(owner.db, {
      respuestaDeRpc: {
        replace_product_image: () =>
          Promise.resolve((owner.db.rpc as (...a: unknown[]) => PromiseLike<unknown>)("replace_product_image", { p_org: org, p_product: id, p_path: `${org}/${id}/no-es-uuid.png` })),
      },
    });

    const r = await setProductImage(db, org, id, png());

    expect(r.ok).toBe(false);
    expect(await rutaDelPlato(id)).toBe(anterior);
    expect(await archivosDelPlato(org, id)).toEqual([anterior]);
  });

  it("si se pierde la respuesta pero la base SÍ aplicó el cambio: queda la foto nueva, se informa limpieza incompleta y no se rompe nada", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    const anterior = await rutaDelPlato(id);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = conGanchos(owner.db, {
      respuestaDeRpc: {
        replace_product_image: async (real) => {
          await real(); // la base lo aplicó…
          return { data: null, error: { message: "TypeError: fetch failed", code: "" } }; // …pero la respuesta no llegó
        },
      },
    });

    try {
      const r = await setProductImage(db, org, id, png());

      expect(r).toEqual({ ok: true, data: { filesComplete: false } });
      const vigente = await rutaDelPlato(id);
      expect(vigente).not.toBe(anterior);
      expect(await archivosDelPlato(org, id)).toEqual([anterior, vigente].sort()); // la anterior pudo quedar: no se sabe cuál era
      expect(log).toHaveBeenCalledWith(expect.stringContaining("quedó aplicada pero no se pudo saber cuál reemplazó"));
    } finally {
      log.mockRestore();
    }
  });

  it("si se pierde la respuesta y la base NO aplicó nada: no se borra la subida (podría llegar tarde) y se informa «no sé»", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    const anterior = await rutaDelPlato(id);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = conGanchos(owner.db, {
      respuestaDeRpc: { replace_product_image: async () => ({ data: null, error: { message: "TypeError: fetch failed", code: "" } }) },
    });

    try {
      const r = await setProductImage(db, org, id, png());

      expect(r).toEqual({ ok: false, error: "uncertain" });
      expect(await rutaDelPlato(id)).toBe(anterior);
      expect((await archivosDelPlato(org, id)).length).toBe(2); // la vigente y la subida sin apuntar: se prefiere un archivo de más
    } finally {
      log.mockRestore();
    }
  });

  it("un fallo al limpiar la anterior NO rompe la foto vigente y se informa como limpieza incompleta", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    const anterior = await rutaDelPlato(id);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const casos: [string, Ganchos["borrar"]][] = [
      ["Storage devuelve error", async () => ({ data: null, error: { message: "Storage caído" } })],
      ["Storage descarta el borrado (cero objetos)", async () => ({ data: [], error: null })],
    ];
    try {
      for (const [nombre, borrar] of casos) {
        const db = conGanchos(owner.db, { borrar });
        const r = await setProductImage(db, org, id, png());

        expect(r, nombre).toEqual({ ok: true, data: { filesComplete: false } });
        const vigente = await rutaDelPlato(id);
        expect((await service.storage.from(IMAGE_BUCKET).download(vigente!)).error, nombre).toBeNull(); // la vigente existe
        expect((await loadProduct(owner.db, org, id))?.image_path, nombre).toBe(vigente);
      }
      expect(log).toHaveBeenCalledWith(expect.stringContaining("No se pudo borrar la foto huérfana"));
      // La primera quedó sin borrar (registrada): el archivo anterior sigue en Storage.
      expect(await archivosDelPlato(org, id)).toContain(anterior);
    } finally {
      log.mockRestore();
    }
  });

  it("Storage que lanza una excepción al limpiar tampoco rompe nada", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = conGanchos(owner.db, {
      borrar: async () => {
        throw new Error("red cortada");
      },
    });
    try {
      expect(await setProductImage(db, org, id, png())).toEqual({ ok: true, data: { filesComplete: false } });
    } finally {
      log.mockRestore();
    }
  });

  it("si la cuenta pasa a solo lectura entre la subida y apuntar el plato: no cambia la referencia y la limpieza bloqueada se registra", async () => {
    const { org, id } = await nuevoPlato();
    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    const anterior = await rutaDelPlato(id);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Estado desactualizado: la comprobación previa dijo «se puede», pero la base ya bloqueó.
    const db = conGanchos(owner.db, {
      trasSubir: async () => {
        await setSubscription(service, org, { finEnMs: -20 * DIA_MS });
      },
    });
    try {
      const r = await setProductImage(db, org, id, png());

      expect(r.ok).toBe(false);
      expect(await rutaDelPlato(id)).toBe(anterior);
      // Con la cuenta bloqueada Storage tampoco deja borrar la subida: queda registrada para limpiarla, sin tocar la vigente.
      expect(log).toHaveBeenCalledWith(expect.stringContaining("No se pudo borrar la foto huérfana"));
      expect(await archivosDelPlato(org, id)).toContain(anterior);
    } finally {
      log.mockRestore();
      await setSubscription(service, org, { finEnMs: 5 * DIA_MS });
    }
  });
});

describe("logo del local", () => {
  const trasLogo = async (org: string) => (await loadIdentity(service, org)).logo_path;

  it("dos reemplazos simultáneos no dejan huérfanos ni borran el logo vigente", async () => {
    const org = await nuevaOrg();
    expect((await setLogo(owner.db, org, png())).ok).toBe(true);
    const inicial = await trasLogo(org);
    let resultadoB: Awaited<ReturnType<typeof setLogo>> | undefined;
    const a = conGanchos(owner.db, {
      trasSubir: async () => {
        resultadoB = await setLogo(owner.db, org, png());
      },
    });

    const resultadoA = await setLogo(a, org, png());

    expect(resultadoA).toEqual({ ok: true, filesComplete: true });
    expect(resultadoB).toEqual({ ok: true, filesComplete: true });
    const vigente = await trasLogo(org);
    expect(vigente).not.toBe(inicial);
    expect(await archivosDelLogo(org)).toEqual([vigente]);
  });

  it("varios reemplazos que corren de verdad a la vez terminan con un solo logo", async () => {
    const org = await nuevaOrg();
    expect((await setLogo(owner.db, org, png())).ok).toBe(true);

    const resultados = await Promise.all([setLogo(owner.db, org, png()), setLogo(owner.db, org, png()), setLogo(owner.db, org, png())]);

    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(await archivosDelLogo(org)).toEqual([await trasLogo(org)]);
  });

  it("quitar el logo mientras otro lo reemplaza: no queda ningún archivo huérfano", async () => {
    const org = await nuevaOrg();
    expect((await setLogo(owner.db, org, png())).ok).toBe(true);
    const quita = conGanchos(owner.db, {
      antesDeRpc: {
        replace_organization_logo: async () => {
          expect((await setLogo(owner.db, org, png())).ok).toBe(true);
        },
      },
    });

    expect(await removeLogo(quita, org)).toEqual({ ok: true, filesComplete: true });

    expect(await trasLogo(org)).toBeNull();
    expect(await archivosDelLogo(org)).toEqual([]);
  });

  it("un fallo al limpiar el logo anterior no rompe el vigente y se informa incompleto; la subida de Staff ni siquiera cambia nada", async () => {
    const org = await nuevaOrg();
    expect((await setLogo(owner.db, org, png())).ok).toBe(true);
    const anterior = await trasLogo(org);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await setLogo(conGanchos(owner.db, { borrar: async () => ({ data: [], error: null }) }), org, png());

      expect(r).toEqual({ ok: true, filesComplete: false });
      const vigente = await trasLogo(org);
      expect((await service.storage.from(LOGO_BUCKET).download(vigente!)).error).toBeNull();
      expect(await archivosDelLogo(org)).toEqual([anterior, vigente].sort());
      // El Staff no puede cambiar el logo (solo el Dueño): la base lo bloquea y no se informa un éxito.
      const denegado = await setLogo(staff.db, org, png());
      expect(denegado.ok).toBe(false);
      expect(await trasLogo(org)).toBe(vigente);
    } finally {
      log.mockRestore();
    }
  });

  it("si se pierde la respuesta pero la base aplicó el logo: queda el nuevo y se informa incompleto", async () => {
    const org = await nuevaOrg();
    expect((await setLogo(owner.db, org, png())).ok).toBe(true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = conGanchos(owner.db, {
      respuestaDeRpc: {
        replace_organization_logo: async (real) => {
          await real();
          return { data: null, error: { message: "fetch failed", code: "" } };
        },
      },
    });
    try {
      expect(await setLogo(db, org, png())).toEqual({ ok: true, filesComplete: false });
      expect(await archivosDelLogo(org)).toContain((await trasLogo(org))!);
    } finally {
      log.mockRestore();
    }
  });
});

describe("portada del local", () => {
  const trasCover = async (org: string) => (await loadIdentity(service, org)).cover_path;
  const trasLogo = async (org: string) => (await loadIdentity(service, org)).logo_path;

  it("dos reemplazos simultáneos no dejan huérfanos ni borran la portada vigente ni el logo", async () => {
    const org = await nuevaOrg();
    expect((await setLogo(owner.db, org, png())).ok).toBe(true);
    expect((await setCover(owner.db, org, png())).ok).toBe(true);
    const logo = await trasLogo(org);
    const inicial = await trasCover(org);
    let resultadoB: Awaited<ReturnType<typeof setCover>> | undefined;
    const a = conGanchos(owner.db, {
      trasSubir: async () => {
        resultadoB = await setCover(owner.db, org, png());
      },
    });

    const resultadoA = await setCover(a, org, png());

    expect(resultadoA).toEqual({ ok: true, filesComplete: true });
    expect(resultadoB).toEqual({ ok: true, filesComplete: true });
    const vigente = await trasCover(org);
    expect(vigente).not.toBe(inicial);
    // Solo quedan el logo (intacto) y la portada vigente: ninguna portada desplazada sobrevive.
    expect(await archivosDelLogo(org)).toEqual([logo, vigente].sort());
    expect(await trasLogo(org)).toBe(logo);
  });

  it("varios reemplazos que corren de verdad a la vez terminan con una sola portada", async () => {
    const org = await nuevaOrg();
    expect((await setLogo(owner.db, org, png())).ok).toBe(true);
    expect((await setCover(owner.db, org, png())).ok).toBe(true);
    const logo = await trasLogo(org);

    const resultados = await Promise.all([setCover(owner.db, org, png()), setCover(owner.db, org, png()), setCover(owner.db, org, png())]);

    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(await archivosDelLogo(org)).toEqual([logo, (await trasCover(org))!].sort());
  });

  it("quitar la portada mientras otro la reemplaza: no queda ningún archivo huérfano y el logo sigue", async () => {
    const org = await nuevaOrg();
    expect((await setLogo(owner.db, org, png())).ok).toBe(true);
    expect((await setCover(owner.db, org, png())).ok).toBe(true);
    const logo = await trasLogo(org);
    const quita = conGanchos(owner.db, {
      antesDeRpc: {
        replace_organization_cover: async () => {
          expect((await setCover(owner.db, org, png())).ok).toBe(true);
        },
      },
    });

    expect(await removeCover(quita, org)).toEqual({ ok: true, filesComplete: true });

    expect(await trasCover(org)).toBeNull();
    expect(await archivosDelLogo(org)).toEqual([logo]);
  });

  it("un fallo al limpiar la portada anterior no rompe la vigente y se informa incompleto; el Staff no cambia nada", async () => {
    const org = await nuevaOrg();
    expect((await setCover(owner.db, org, png())).ok).toBe(true);
    const anterior = await trasCover(org);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await setCover(conGanchos(owner.db, { borrar: async () => ({ data: [], error: null }) }), org, png());

      expect(r).toEqual({ ok: true, filesComplete: false });
      const vigente = await trasCover(org);
      expect((await service.storage.from(LOGO_BUCKET).download(vigente!)).error).toBeNull();
      expect(await archivosDelLogo(org)).toEqual([anterior, vigente].sort());
      expect((await setCover(staff.db, org, png())).ok).toBe(false);
      expect(await trasCover(org)).toBe(vigente);
    } finally {
      log.mockRestore();
    }
  });
});
