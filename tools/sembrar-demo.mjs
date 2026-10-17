#!/usr/bin/env node
/**
 * Llena la demo local con una carta completa: más categorías y platos, descripciones, etiquetas dietarias, variantes y
 * adicionales, un plato agotado por local, fotos reales y un logo, SOLO EN DESARROLLO LOCAL. Sirve para ver y rediseñar la
 * carta pública con material de verdad (organizaciones `cafe-ejemplo` y `parrilla-demo`).
 *
 * Uso (desde la raíz, con el Supabase local encendido):  pnpm db:demo      (o node tools/sembrar-demo.mjs)
 * Es idempotente: vuelve a dejar la demo igual aunque ya estuviera llena. `--quitar` la devuelve al estado del seed.
 * Opciones para ver el peor caso de un local chico: `--sin-fotos` (ningún plato con foto) y `--sin-logo`; se pueden combinar.
 *
 * La demo pasa las dos organizaciones al plan Pro para que `/t/{token}` muestre «Llamar al mozo» y «Pedir la cuenta»
 * (mesas del seed: `/t/c0ffee01000000000000000000000000` en Café Ejemplo y `/t/fa11a001000000000000000000000000` en
 * Parrilla Demo); `--quitar` las devuelve a Básico.
 *
 * IMPORTANTE: las pruebas de RLS y E2E asumen el seed limpio. Antes de correrlas: `pnpm db:reset` (o `pnpm db:demo --quitar`).
 *
 * Las filas nuevas usan ids con sufijo 000000001NNN, y `--quitar` las borra por ese rango. Las fotos son de Unsplash
 * (licencia Unsplash: uso libre, también comercial, sin atribución obligatoria); se descargan una vez a `.demo-cache/`
 * (ignorada por Git) y no se versionan. Los logos son insignias sintéticas dibujadas con formas simples.
 * Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local / .env.test.local y se niega a correr contra
 * cualquier URL que no sea local. Usa `sharp`, que ya viene con Next (no es una dependencia nueva).
 */
import { createClient } from "@supabase/supabase-js";
import { descargar, FOTO, logo, ORGS, plan, range, uuidFrom } from "./demo/catalogo.mjs";

for (const file of [".env.local", ".env.test.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Si falta alguno, se avisa abajo por la variable que falte.
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (.env.local o .env.test.local).");
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error(`Esta herramienta es solo para el Supabase local; la URL configurada apunta a ${new URL(url).hostname}.`);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const IMAGES = "product-images";
const LOGOS = "organization-logos";

const check = (result, what) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};

async function quitarOrg(def) {
  for (const table of ["option_groups", "products", "categories"]) {
    const prefix = def.prefix[{ option_groups: "grp", products: "prod", categories: "cat" }[table]];
    const [lo, hi] = range(prefix);
    check(await db.from(table).delete().eq("organization_id", def.org).gte("id", lo).lte("id", hi), `borrar ${table} de la demo`);
  }
  const semilla = def.categorias.flatMap((cat) => cat.platos.filter((plato) => plato.id));
  for (const plato of semilla) {
    const reset = { image_path: null, ...(plato.desc ? { description: null } : {}), ...(plato.tags ? { dietary_tags: [] } : {}) };
    check(await db.from("products").update(reset).eq("id", plato.id), "restaurar un plato del seed");
  }
  const productos = check(await db.from("products").select("id").eq("organization_id", def.org), "listar platos");
  for (const { id } of productos) {
    const { data } = await db.storage.from(IMAGES).list(`${def.org}/${id}`, { limit: 100 });
    const paths = (data ?? []).map((file) => `${def.org}/${id}/${file.name}`);
    if (paths.length) await db.storage.from(IMAGES).remove(paths);
  }
  const { data: logos } = await db.storage.from(LOGOS).list(def.org, { limit: 100 });
  const logoPaths = (logos ?? []).map((file) => `${def.org}/${file.name}`);
  if (logoPaths.length) await db.storage.from(LOGOS).remove(logoPaths);
  check(await db.from("organizations").update({ logo_path: null }).eq("id", def.org), "quitar el logo");
  check(await db.from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", def.org), "volver al plan Básico");
}

async function sembrarOrg(def) {
  await quitarOrg(def);
  const { categorias, platos, grupos, opciones } = plan(def);
  if (categorias.length) check(await db.from("categories").insert(categorias), "crear categorías");
  const nuevos = platos.filter((plato) => plato.nuevo).map((plato) => ({
    id: plato.id, organization_id: def.org, category_id: plato.catId, name: plato.name, description: plato.desc ?? null,
    price_cents: plato.price, sort_order: plato.sort + 10, is_active: true, dietary_tags: plato.tags ?? [],
  }));
  if (nuevos.length) check(await db.from("products").insert(nuevos), "crear platos");
  for (const plato of platos.filter((p) => !p.nuevo)) {
    const patch = { ...(plato.desc ? { description: plato.desc } : {}), ...(plato.tags ? { dietary_tags: plato.tags } : {}) };
    if (Object.keys(patch).length) check(await db.from("products").update(patch).eq("id", plato.id), "completar un plato del seed");
  }
  if (grupos.length) check(await db.from("option_groups").insert(grupos), "crear variantes y adicionales");
  if (opciones.length) check(await db.from("options").insert(opciones), "crear opciones");
  const agotados = platos.filter((plato) => plato.agotado).map((plato) => ({ organization_id: def.org, branch_id: def.branch, product_id: plato.id, is_available: false }));
  if (agotados.length) check(await db.from("product_availability").upsert(agotados, { onConflict: "branch_id,product_id" }), "marcar agotados");

  const conFoto = sinFotos ? [] : platos.filter((plato) => plato.foto);
  const unicas = [...new Set(conFoto.map((plato) => plato.foto))];
  const bytes = new Map();
  for (let i = 0; i < unicas.length; i += 6) {
    await Promise.all(unicas.slice(i, i + 6).map(async (clave) => bytes.set(clave, await descargar(FOTO[clave]))));
  }
  for (const plato of conFoto) {
    const path = `${def.org}/${plato.id}/${uuidFrom(`foto:${plato.id}`)}.jpg`;
    check(await db.storage.from(IMAGES).upload(path, bytes.get(plato.foto), { contentType: "image/jpeg", upsert: true }), `subir la foto de ${plato.name ?? plato.id}`);
    check(await db.from("products").update({ image_path: path }).eq("id", plato.id), "guardar la foto");
  }
  check(await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", def.org), "pasar al plan Pro");
  if (!sinLogo) {
    const logoPath = `${def.org}/${uuidFrom(`logo:${def.org}`)}.png`;
    check(await db.storage.from(LOGOS).upload(logoPath, await logo(def.logo), { contentType: "image/png", upsert: true }), "subir el logo");
    check(await db.from("organizations").update({ logo_path: logoPath }).eq("id", def.org), "guardar el logo");
  }
  console.log(`${def.slug}: ${categorias.length} categorías nuevas, ${platos.length} platos (${conFoto.length} con foto), ${grupos.length} grupos de opciones, ${agotados.length} agotado, ${sinLogo ? "sin logo" : "logo"}, plan Pro.`);
}

const quitar = process.argv.includes("--quitar");
const sinFotos = process.argv.includes("--sin-fotos");
const sinLogo = process.argv.includes("--sin-logo");
for (const def of ORGS) {
  const found = check(await db.from("organizations").select("id").eq("id", def.org).maybeSingle(), "leer la organización");
  if (!found) throw new Error(`No existe ${def.slug}: corré antes pnpm db:reset (la demo se apoya en el seed).`);
  if (quitar) {
    await quitarOrg(def);
    console.log(`${def.slug}: vuelto al estado del seed.`);
  } else {
    await sembrarOrg(def);
  }
}
