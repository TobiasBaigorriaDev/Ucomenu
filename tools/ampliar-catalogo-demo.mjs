#!/usr/bin/env node
/**
 * SUMA categorías y platos (con foto) a un local de demostración. No borra ni modifica nada de lo que ya tiene el local: a diferencia de
 * `sembrar-demo-staging.mjs`, que deja el catálogo como se diseñó, esta herramienta es aditiva y se puede repetir (omite lo que ya existe).
 * Las definiciones están en `tools/demo/ampliaciones.mjs`.
 *
 * Uso (las credenciales van por entorno; no se imprimen):
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<clave de servicio> \
 *     node tools/ampliar-catalogo-demo.mjs --proyecto <ref> --local <slug>
 *   (solo con el Supabase local: --prueba-local en lugar de --proyecto)
 *
 * Protecciones: exige `--local <slug>` y que la URL sea exactamente `https://<ref>.supabase.co`; no toca organizaciones que no estén
 * definidas en `tools/demo/locales-staging.mjs` con el mismo id y slug.
 */
import { createClient } from "@supabase/supabase-js";
import { descargar, FOTO, uuidFrom } from "./demo/catalogo.mjs";
import { AMPLIACIONES } from "./demo/ampliaciones.mjs";
import { LOCALES } from "./demo/locales-staging.mjs";

const args = process.argv.slice(2);
const valor = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const projectRef = valor("--proyecto");
const slug = valor("--local");
const pruebaLocal = args.includes("--prueba-local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
const host = new URL(url).hostname;
if (pruebaLocal) {
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error("--prueba-local solo vale con el Supabase local.");
} else {
  if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("Falta --proyecto <ref> (la referencia de 20 caracteres).");
  if (host !== `${projectRef}.supabase.co`) throw new Error(`La URL (${host}) no coincide con --proyecto ${projectRef}.`);
}
if (!slug || slug.startsWith("--")) throw new Error("Falta --local <slug>.");
const def = LOCALES.find((l) => l.slug === slug);
const categoriasNuevas = AMPLIACIONES[slug];
if (!def || !categoriasNuevas) throw new Error(`No hay una ampliación para «${slug}» (${Object.keys(AMPLIACIONES).join(", ")}).`);

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const check = (result, what) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};

const org = check(await db.from("organizations").select("id,slug").eq("slug", slug).maybeSingle(), "leer la organización");
if (!org) throw new Error(`El local «${slug}» no existe en este proyecto.`);
if (org.id !== def.org) throw new Error(`El local «${slug}» tiene otro identificador que el de la demo: no se toca.`);

const existentes = check(await db.from("categories").select("id,name,sort_order").eq("organization_id", org.id), "leer las categorías");
let siguienteOrden = existentes.reduce((max, c) => Math.max(max, c.sort_order), 0) + 1;
let categoriasCreadas = 0;
let platosCreados = 0;
const fotos = [];

for (const cat of categoriasNuevas) {
  let categoria = existentes.find((c) => c.name === cat.name);
  if (!categoria) {
    categoria = { id: uuidFrom(`ampliacion:${org.id}:cat:${cat.name}`), name: cat.name, sort_order: siguienteOrden++ };
    check(await db.from("categories").insert({ id: categoria.id, organization_id: org.id, name: cat.name, sort_order: categoria.sort_order, is_active: true }), `crear la categoría ${cat.name}`);
    categoriasCreadas += 1;
  }
  const platosDeLaCategoria = check(await db.from("products").select("id,name,sort_order").eq("category_id", categoria.id), "leer los platos");
  let orden = platosDeLaCategoria.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
  for (const plato of cat.platos) {
    if (platosDeLaCategoria.some((p) => p.name === plato.name)) continue;
    if (!FOTO[plato.foto]) throw new Error(`La foto «${plato.foto}» no está en el catálogo.`);
    const id = uuidFrom(`ampliacion:${org.id}:prod:${cat.name}:${plato.name}`);
    check(
      await db.from("products").insert({
        id, organization_id: org.id, category_id: categoria.id, name: plato.name, description: plato.desc ?? null,
        price_cents: plato.price, sort_order: orden++, is_active: true, dietary_tags: plato.tags ?? [],
      }),
      `crear el plato ${plato.name}`,
    );
    fotos.push({ id, name: plato.name, foto: plato.foto });
    platosCreados += 1;
  }
}

let bytesTotales = 0;
for (const f of fotos) {
  const bytes = await descargar(FOTO[f.foto]);
  bytesTotales += bytes.length;
  const path = `${org.id}/${f.id}/${uuidFrom(`foto:${f.id}`)}.jpg`;
  check(await db.storage.from("product-images").upload(path, bytes, { contentType: "image/jpeg", upsert: true }), `subir la foto de ${f.name}`);
  check(await db.from("products").update({ image_path: path }).eq("id", f.id), `guardar la foto de ${f.name}`);
}

console.log(`${slug}: ${categoriasCreadas} categorías nuevas, ${platosCreados} platos nuevos con foto (${(bytesTotales / 1024 / 1024).toFixed(1)} MB). Lo que ya tenía no se tocó.`);
console.log(`Carta: /m/${slug}/centro (en el dominio de la app).`);
