#!/usr/bin/env node
/**
 * Carga una carta de demostración COMPLETA (unos 30 platos con foto, variantes, etiquetas, un plato agotado, mesas y logo)
 * en una organización propia, `demo`, del proyecto de STAGING de Supabase. Datos y fotos ficticios; no toca ninguna otra
 * organización.
 *
 * Uso (las credenciales van por entorno, nunca por archivo ni argumento posicional; no se imprimen):
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<clave de servicio> \
 *     node tools/sembrar-demo-staging.mjs --proyecto <ref>            # carga (idempotente: la vuelve a dejar igual)
 *     node tools/sembrar-demo-staging.mjs --proyecto <ref> --quitar   # quita el catálogo, las fotos y el logo
 *
 * Protecciones: exige `--proyecto <ref>` y que la URL sea exactamente `https://<ref>.supabase.co` (así un cambio de
 * proyecto enlazado no la dirige a otro por accidente). `--prueba-local` (solo con el Supabase local) sirve para ensayarla. La organización se crea sin ninguna cuenta: quien la edite se suma como Dueño desde SuperAdmin
 * («Sumar un Dueño»). La suscripción queda en plan Pro y vigente por unos 700 días para que la demo no caduque (el alta
 * normal por SuperAdmin acepta hasta 731 días); si hace falta otra, se cambia desde SuperAdmin. Esta herramienta escribe
 * con la clave de servicio y no deja filas en `audit_log`: es una herramienta de demostración, no un alta de cliente.
 * Para producción (datos reales de clientes) no se usa sin una decisión aparte.
 */
import { createClient } from "@supabase/supabase-js";
import { descargar, FOTO, logo, ORGS, plan, uuidFrom } from "./demo/catalogo.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const projectRef = args.includes("--proyecto") ? args[args.indexOf("--proyecto") + 1] : undefined;
const quitar = flag("--quitar");
const pruebaLocal = flag("--prueba-local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
const host = new URL(url).hostname;
if (pruebaLocal) {
  // Solo para ensayar el script contra el Supabase local; nunca contra un proyecto remoto.
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error("--prueba-local solo vale con el Supabase local.");
} else {
  if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("Falta --proyecto <ref> (la referencia de 20 caracteres del proyecto de staging).");
  if (host !== `${projectRef}.supabase.co`) throw new Error(`La URL (${host}) no coincide con --proyecto ${projectRef}.`);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const IMAGES = "product-images";
const LOGOS = "organization-logos";

const check = (result, what) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};

const ORG = "d0000000-0000-4000-8000-000000000001";
const BRANCH = "d1000000-0000-4000-8000-000000000001";
const SLUG = "demo";

// Los platos de la carta local que ya viven en el seed solo traen id y foto (el nombre y el precio están en `seed.sql`):
// acá se completan para crearlos como platos nuevos.
const DEL_SEED = {
  "13000000-0000-4000-8000-000000000001": { name: "Espresso", desc: "Blend de la casa, tostado medio. Doble por defecto.", price: 280000, tags: ["gluten_free"] },
  "13000000-0000-4000-8000-000000000002": { name: "Flat white", desc: "Doble espresso con leche texturizada, servido en taza chica para que el café se note.", price: 420000 },
  "13000000-0000-4000-8000-000000000004": { name: "Medialuna de manteca", price: 150000, tags: ["vegetarian"] },
};

/** La carta de Café Ejemplo (la local) sin depender de su seed: todo se crea con ids propios de esta organización. */
function definicion() {
  const base = ORGS.find((o) => o.slug === "cafe-ejemplo");
  return {
    ...base,
    slug: SLUG,
    org: ORG,
    branch: BRANCH,
    categorias: base.categorias.map(({ id: _id, ...cat }) => ({
      ...cat,
      platos: cat.platos.map(({ id, ...plato }) => (id ? { ...DEL_SEED[id], ...plato } : plato)),
    })),
  };
}

async function quitarCatalogo(def) {
  for (const table of ["option_groups", "products", "categories"]) {
    check(await db.from(table).delete().eq("organization_id", def.org), `borrar ${table}`);
  }
  for (const bucket of [IMAGES, LOGOS]) {
    // Los objetos viven en `{org}/...` (el logo directo; las fotos en una carpeta por plato).
    const { data: raiz } = await db.storage.from(bucket).list(def.org, { limit: 1000 });
    const rutas = [];
    for (const item of raiz ?? []) {
      if (item.id) rutas.push(`${def.org}/${item.name}`);
      else {
        const { data: hijos } = await db.storage.from(bucket).list(`${def.org}/${item.name}`, { limit: 1000 });
        for (const hijo of hijos ?? []) rutas.push(`${def.org}/${item.name}/${hijo.name}`);
      }
    }
    if (rutas.length) check(await db.storage.from(bucket).remove(rutas), `borrar archivos de ${bucket}`);
  }
}

async function asegurarOrganizacion(def) {
  const existente = check(await db.from("organizations").select("id").eq("id", def.org).maybeSingle(), "leer la organización");
  if (!existente) {
    const otra = check(await db.from("organizations").select("id").eq("slug", SLUG).maybeSingle(), "comprobar el identificador");
    if (otra) throw new Error(`Ya existe otra organización con el identificador «${SLUG}»: no se toca.`);
    check(await db.from("organizations").insert({ id: def.org, slug: SLUG, name: "Café Demo", menu_palette: "oliva" }), "crear la organización");
    check(await db.from("branches").insert({ id: def.branch, organization_id: def.org, slug: "centro", name: "Centro" }), "crear la sucursal");
    const mesas = ["Mesa 1", "Mesa 2", "Mesa 3", "Mesa 4"].map((label) => ({ organization_id: def.org, branch_id: def.branch, label }));
    check(await db.from("tables").insert(mesas), "crear las mesas");
  }
  const vencimiento = new Date(Date.now() + 700 * 24 * 3600 * 1000).toISOString();
  // La prueba gratuita de 14 días la crea el alta; se reemplaza por Pro vigente para que la demo no caduque.
  check(
    await db.from("subscriptions").update({ plan_code: "pro", billing_cycle: "yearly", current_period_end: vencimiento, trial_ends_at: null }).eq("organization_id", def.org),
    "dejar el plan Pro vigente",
  );
}

async function sembrar(def) {
  await asegurarOrganizacion(def);
  await quitarCatalogo(def);
  const { categorias, platos, grupos, opciones } = plan(def);
  check(await db.from("categories").insert(categorias), "crear categorías");
  const filas = platos.map((p) => ({
    id: p.id, organization_id: def.org, category_id: p.catId, name: p.name, description: p.desc ?? null,
    price_cents: p.price, sort_order: p.sort, is_active: true, dietary_tags: p.tags ?? [],
  }));
  check(await db.from("products").insert(filas), "crear platos");
  if (grupos.length) check(await db.from("option_groups").insert(grupos), "crear variantes y adicionales");
  if (opciones.length) check(await db.from("options").insert(opciones), "crear opciones");
  const agotados = platos.filter((p) => p.agotado).map((p) => ({ organization_id: def.org, branch_id: def.branch, product_id: p.id, is_available: false }));
  if (agotados.length) check(await db.from("product_availability").upsert(agotados, { onConflict: "branch_id,product_id" }), "marcar agotados");

  const conFoto = platos.filter((p) => p.foto);
  const unicas = [...new Set(conFoto.map((p) => p.foto))];
  const bytes = new Map();
  for (let i = 0; i < unicas.length; i += 6) {
    await Promise.all(unicas.slice(i, i + 6).map(async (clave) => bytes.set(clave, await descargar(FOTO[clave]))));
  }
  for (const p of conFoto) {
    const path = `${def.org}/${p.id}/${uuidFrom(`foto:${p.id}`)}.jpg`;
    check(await db.storage.from(IMAGES).upload(path, bytes.get(p.foto), { contentType: "image/jpeg", upsert: true }), `subir la foto de ${p.name}`);
    check(await db.from("products").update({ image_path: path }).eq("id", p.id), "guardar la foto");
  }
  const logoPath = `${def.org}/${uuidFrom(`logo:${def.org}`)}.png`;
  check(await db.storage.from(LOGOS).upload(logoPath, await logo(def.logo), { contentType: "image/png", upsert: true }), "subir el logo");
  check(await db.from("organizations").update({ logo_path: logoPath }).eq("id", def.org), "guardar el logo");
  const total = [...bytes.values()].reduce((suma, b) => suma + b.length, 0);
  console.log(
    `${SLUG}: ${categorias.length} categorías, ${platos.length} platos (${conFoto.length} con foto, ${(total / 1024 / 1024).toFixed(1)} MB), ` +
      `${grupos.length} grupos de opciones, ${agotados.length} agotado, 4 mesas, logo, plan Pro vigente.`,
  );
  console.log("Carta: /m/demo/centro (en el dominio de la app).");
}

const def = definicion();
if (quitar) {
  await quitarCatalogo(def);
  check(await db.from("organizations").update({ logo_path: null }).eq("id", ORG), "quitar el logo");
  console.log("demo: catálogo, fotos y logo quitados (la organización y sus mesas quedan).");
} else {
  await sembrar(def);
}
