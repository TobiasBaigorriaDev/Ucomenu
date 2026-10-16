#!/usr/bin/env node
/**
 * Siembra una carta «pesada» para medir el rendimiento (ficha rendimiento-carta-publica), SOLO EN DESARROLLO LOCAL:
 * organización `medicion-carta`, sucursal `centro`, 6 categorías con 6 platos cada una y una foto por plato, con el
 * tamaño que deja la reducción del panel (1600 px de lado mayor, JPEG de unos cientos de KB). Es el peor caso realista.
 *
 * Uso (desde la raíz, con el Supabase local encendido):  node tools/sembrar-carta-medicion.mjs
 * Es idempotente: si la organización ya existe, la borra y la vuelve a crear. `--quitar` solo la borra.
 *
 * Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local / .env.test.local y se niega a correr
 * contra cualquier URL que no sea local. Genera las fotos con `sharp`, que ya viene con Next (no es una dependencia nueva).
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

for (const file of [".env.local", ".env.test.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Si falta alguno, se avisa abajo por la variable que falte.
  }
}

const SLUG = "medicion-carta";
const CATEGORIAS = ["Entradas", "Pastas", "Parrilla", "Ensaladas", "Postres", "Bebidas"];
const PLATOS_POR_CATEGORIA = 6;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (.env.local o .env.test.local).");
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error(`Esta herramienta es solo para el Supabase local; la URL configurada apunta a ${new URL(url).hostname}.`);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const check = (result, what) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};

async function quitar() {
  const org = check(await db.from("organizations").select("id").eq("slug", SLUG).maybeSingle(), "leer la organización");
  if (!org) return;
  const { data: files } = await db.storage.from("product-images").list(org.id, { limit: 1000 });
  for (const folder of files ?? []) {
    const { data: inner } = await db.storage.from("product-images").list(`${org.id}/${folder.name}`, { limit: 100 });
    const paths = (inner ?? []).map((file) => `${org.id}/${folder.name}/${file.name}`);
    if (paths.length > 0) await db.storage.from("product-images").remove(paths);
  }
  check(await db.from("organizations").delete().eq("id", org.id), "borrar la organización");
}

/** Una «foto» sintética: degradados suaves con ruido fino, que comprime a unos cientos de KB como una foto real. */
async function foto(sharp, seed) {
  const width = 1600;
  const height = 1200;
  const raw = Buffer.alloc(width * height * 3);
  let state = seed * 2654435761;
  const noise = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state >> 16) % 28;
  };
  // Varias octavas de ondas (de 400 a 20 px) más ruido fino: tiene detalle a todas las escalas, como una foto, y no se
  // vuelve un color liso al reducirla (que haría pasar por barato lo que en una foto real pesa más).
  const octavas = [400, 170, 80, 40, 20].map((period, k) => ({ period, amp: 34 / (k + 1) ** 0.6, fx: 1 + (seed % 5) * 0.13, fy: 1 + (seed % 7) * 0.09 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [k, o] of octavas.entries()) {
        r += o.amp * Math.sin((x * o.fx + seed * 37 * (k + 1)) / o.period) * Math.cos((y + seed * 11) / (o.period * o.fy));
        g += o.amp * Math.sin((y * o.fy + seed * 53 * (k + 1)) / o.period) * Math.cos((x + seed * 7) / (o.period * o.fx));
        b += o.amp * Math.sin((x + y + seed * 29 * (k + 1)) / (o.period * 1.3));
      }
      raw[i] = 140 + r + noise();
      raw[i + 1] = 110 + g + noise();
      raw[i + 2] = 90 + b + noise();
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

async function main() {
  await quitar();
  if (process.argv.includes("--quitar")) return console.log("Carta de medición borrada.");

  const sharp = createRequire(createRequire(import.meta.url).resolve("next/package.json"))("sharp");

  const org = check(await db.from("organizations").insert({ slug: SLUG, name: "Medición Carta" }).select("id").single(), "crear la organización");
  check(
    await db.from("subscriptions").update({ current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(), trial_ends_at: null }).eq("organization_id", org.id),
    "fijar la suscripción",
  );
  check(await db.from("branches").insert({ organization_id: org.id, slug: "centro", name: "Centro" }), "crear la sucursal");

  let seed = 1;
  let bytes = 0;
  for (const [c, name] of CATEGORIAS.entries()) {
    const category = check(
      await db.from("categories").insert({ organization_id: org.id, name, sort_order: c }).select("id").single(),
      "crear la categoría",
    );
    for (let p = 0; p < PLATOS_POR_CATEGORIA; p++) {
      const id = randomUUID();
      const path = `${org.id}/${id}/${randomUUID()}.jpg`;
      const body = await foto(sharp, seed++);
      bytes += body.length;
      check(await db.storage.from("product-images").upload(path, body, { contentType: "image/jpeg" }), "subir la foto");
      check(
        await db.from("products").insert({
          id,
          organization_id: org.id,
          category_id: category.id,
          name: `${name} ${p + 1}: plato de la casa con nombre algo largo`,
          description: "Descripción de ejemplo de dos renglones para que la lista tenga un largo parecido al de una carta real.",
          price_cents: 450_000 + p * 25_000,
          sort_order: p,
          image_path: path,
        }),
        "crear el plato",
      );
    }
  }
  const total = CATEGORIAS.length * PLATOS_POR_CATEGORIA;
  console.log(`Listo: /m/${SLUG}/centro con ${total} platos y ${total} fotos (${Math.round(bytes / 1024)} KB en total, ${Math.round(bytes / total / 1024)} KB por foto).`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
