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
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

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
const sharp = createRequire(createRequire(import.meta.url).resolve("next/package.json"))("sharp");
const CACHE = ".demo-cache";
const IMAGES = "product-images";
const LOGOS = "organization-logos";

const check = (result, what) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};

/** Ids de Unsplash (las fotos se piden a 1280 px y se reducen otra vez acá). */
const FOTO = {
  espresso: "1514432324607-a09d9b4aefdd", latteArt: "1541167760496-1628856ab772", cafes: "1509042239860-f550ce710b93",
  brindis: "1495474472287-4d71bcdd2085", coldBrew: "1461023058943-07fcbe16d735", granos: "1447933601403-0c6688de566e",
  medialuna: "1555507036-ab1f4038808a", tortaFrambuesa: "1565958011703-44f9829ba187", tortaChocolate: "1578985545062-69928b1d9587",
  cookies: "1558961363-fa8fdf82db35", desayuno: "1504754524776-8f4f37790ca0", tostadaHuevo: "1525351484163-7529414344d8",
  frances: "1484723091739-30a097e8f929", panqueques: "1567620905732-2d1ec7ab7445", tostado: "1528735602780-2552fd46c7af",
  ensaladaSalmon: "1546069901-ba9599a7e63c", bowl: "1512621776951-a57141f2eefd", hamburguesa: "1481070555726-e2fe8357725c",
  jugo: "1600271886742-f049cd451bba", teHelado: "1556679343-c7306c1976bc", agua: "1523362628745-0c100150b504",
  copa: "1563805042-7684c019e1cb", helado: "1551024506-0bccd828d307", paletas: "1488900128323-21503983a07e",
  entrana: "1558030006-450675393462", asado: "1529193591184-b1d58069ecdd", costillar: "1544025162-d76694265947",
  parrillada: "1555939594-58d7cb561ad1", tacos: "1565299585323-38d6b0865b47", penne: "1621996346565-e3dbc646d9a9",
  tagliatelle: "1551183053-bf91a1d81141", pizza: "1565299624946-b28f40a0ae38", salmon: "1519708227418-c8fd9a32b7a2",
  bondiola: "1432139555190-58524dae6a55", burger: "1551782450-a2132b4ba21d", ensaladaMixta: "1540189549336-e6e99c3679fe",
  ensaladaPasta: "1473093295043-cdd812d0e601", vino: "1510812431401-41d2bd2722f3", oldFashioned: "1470337458703-46ad1756a187",
  coctel: "1514362545857-3bc16c4c7d1b", coctelAutor: "1544145945-f90425340c7e", gaseosa: "1556679343-c7306c1976bc",
};

const GF = "gluten_free";
const VG = "vegan";
const VT = "vegetarian";

// Precios en centavos de ARS. `id` solo en platos y categorías que ya existen en el seed (solo reciben foto o descripción).
const ORGS = [
  {
    slug: "cafe-ejemplo",
    org: "10000000-0000-4000-8000-000000000001",
    branch: "11000000-0000-4000-8000-000000000001",
    prefix: { cat: "12", prod: "13", grp: "14", opt: "15" },
    logo: { fondo: "#3d5f48", trazo: "#f4efe4", glifo: "taza" },
    categorias: [
      {
        id: "12000000-0000-4000-8000-000000000001",
        name: "Cafetería",
        platos: [
          { id: "13000000-0000-4000-8000-000000000001", foto: "espresso" },
          { id: "13000000-0000-4000-8000-000000000002", foto: "latteArt" },
          { name: "Cappuccino", desc: "Espresso doble con leche vaporizada y una capa de espuma densa. Canela a pedido.", price: 440000, foto: "cafes",
            grupos: [{ name: "Tamaño", min: 1, max: 1, opciones: [["Chico", 0], ["Grande", 50000]] }] },
          { name: "Latte", desc: "Café suave con mucha leche, servido en vaso alto. Ideal para quedarse un rato.", price: 460000, foto: "brindis",
            grupos: [{ name: "Leche", min: 1, max: 1, opciones: [["Entera", 0], ["Descremada", 0], ["De almendras", 30000], ["De avena", 30000]] }] },
          { name: "Cold brew", desc: "Café infusionado en frío durante dieciocho horas. Dulce, redondo y sin amargor.", price: 480000, foto: "coldBrew", tags: [VG, GF] },
          { name: "Cortado", desc: "Espresso con un toque de leche caliente.", price: 320000 },
          { name: "Café filtrado de la casa", desc: "Preparado en V60 con el grano del mes. Pedilo y mirá cómo se hace.", price: 350000 },
          { name: "Granos de la casa (250 g)", desc: "Café de especialidad tostado a pocos kilómetros de acá. Para llevar a casa.", price: 1280000, foto: "granos", tags: [VG, GF] },
        ],
      },
      {
        id: "12000000-0000-4000-8000-000000000002",
        name: "Pastelería",
        platos: [
          { id: "13000000-0000-4000-8000-000000000004", foto: "medialuna", desc: "Hojaldrada, dorada y todavía tibia. La clásica del desayuno." },
          { name: "Torta de frambuesa", desc: "Bizcochuelo de vainilla, crema liviana y frambuesas frescas. Porción generosa.", price: 520000, foto: "tortaFrambuesa", tags: [VT], agotado: true },
          { name: "Torta de chocolate", desc: "Tres capas de bizcocho húmedo con ganache de chocolate semiamargo.", price: 540000, foto: "tortaChocolate", tags: [VT] },
          { name: "Cookies de chocolate (3 u.)", desc: "Crocantes por fuera, blandas por dentro, con chips de chocolate negro.", price: 280000, foto: "cookies", tags: [VT] },
        ],
      },
      {
        name: "Desayunos",
        platos: [
          { name: "Desayuno completo", desc: "Bebida caliente a elección, jugo de naranja exprimido, tostadas con mermelada y una medialuna.", price: 980000, foto: "desayuno",
            grupos: [{ name: "Bebida caliente", min: 1, max: 1, opciones: [["Café con leche", 0], ["Té", 0], ["Cappuccino", 40000]] }] },
          { name: "Tostada con huevo y palta", desc: "Pan de masa madre, palta pisada, huevo a la plancha, ají molido y limón.", price: 780000, foto: "tostadaHuevo", tags: [VT],
            grupos: [{ name: "Extras", min: 0, max: 3, opciones: [["Huevo extra", 20000], ["Palta extra", 30000], ["Queso crema", 20000]] }] },
          { name: "Tostadas francesas", desc: "Brioche rebozado, banana y arándanos, con miel de la casa.", price: 820000, foto: "frances", tags: [VT] },
          { name: "Panqueques con banana", desc: "Una torre de panqueques esponjosos con miel y banana caramelizada.", price: 760000, foto: "panqueques", tags: [VT] },
        ],
      },
      {
        name: "Salados",
        platos: [
          { name: "Tostado de jamón y queso", desc: "En pan de miga tostado, con queso derretido y jamón cocido natural.", price: 690000, foto: "tostado" },
          { name: "Ensalada de salmón", desc: "Salmón rosado, hojas verdes, choclo, tomate cherry y huevo. Aderezo de limón.", price: 1150000, foto: "ensaladaSalmon", tags: [GF] },
          { name: "Bowl de palta y garbanzos", desc: "Palta, garbanzos, remolacha, zanahoria, brotes y semillas. Aderezo de tahini.", price: 990000, foto: "bowl", tags: [VG, VT, GF] },
          { name: "Hamburguesa de la casa", desc: "Medallón de carne, repollo morado, cebolla caramelizada y salsa ahumada, en pan de papa.", price: 1280000, foto: "hamburguesa" },
        ],
      },
      {
        name: "Bebidas frías",
        platos: [
          { name: "Jugo de naranja", desc: "Exprimido en el momento, sin azúcar agregada.", price: 480000, foto: "jugo", tags: [VG, GF] },
          { name: "Té helado con lima", desc: "Té negro infusionado en frío, con limón y hielo.", price: 380000, foto: "teHelado", tags: [VG, GF] },
          { name: "Agua mineral sin gas", desc: "Botella de 500 ml.", price: 250000, foto: "agua", tags: [VG, GF] },
        ],
      },
      {
        name: "Postres",
        platos: [
          { name: "Copa helada de chocolate", desc: "Helado de crema, brownie, salsa de chocolate y galletitas trituradas.", price: 720000, foto: "copa", tags: [VT] },
          { name: "Helado de caramelo", desc: "Dos bochas de helado artesanal con salsa de caramelo salado y barquillo.", price: 650000, foto: "helado", tags: [VT] },
          { name: "Paletas de frutos del bosque", desc: "Helado de agua con frutos rojos. Sin lácteos.", price: 480000, foto: "paletas", tags: [VG, GF] },
        ],
      },
    ],
  },
  {
    slug: "parrilla-demo",
    org: "20000000-0000-4000-8000-000000000001",
    branch: "21000000-0000-4000-8000-000000000001",
    prefix: { cat: "22", prod: "23", grp: "24", opt: "25" },
    logo: { fondo: "#654633", trazo: "#f5efe3", glifo: "llama" },
    categorias: [
      {
        id: "22000000-0000-4000-8000-000000000001",
        name: "Parrilla",
        platos: [
          { id: "23000000-0000-4000-8000-000000000001", foto: "entrana" },
          { id: "23000000-0000-4000-8000-000000000002", desc: "Queso provolone fundido sobre las brasas, con orégano y un chorrito de aceite de oliva.", tags: [VT] },
          { name: "Asado de tira", desc: "Cortado grueso, cocido a fuego lento sobre brasas de quebracho.", price: 1480000, foto: "asado", agotado: true,
            grupos: [{ name: "Punto de cocción", min: 1, max: 1, opciones: [["Jugoso", 0], ["A punto", 0], ["Bien cocido", 0]] }] },
          { name: "Bife de chorizo", desc: "Trescientos gramos de corte clásico, sellado a la parrilla. Se sirve con la guarnición que elijas.", price: 1560000,
            grupos: [
              { name: "Punto de cocción", min: 1, max: 1, opciones: [["Jugoso", 0], ["A punto", 0], ["Bien cocido", 0]] },
              { name: "Guarnición", min: 1, max: 1, opciones: [["Papas rústicas", 0], ["Puré de calabaza", 0], ["Ensalada mixta", 0]] },
            ] },
          { name: "Costillar a la parrilla", desc: "Costillas de cerdo glaseadas con salsa barbacoa casera, con papas fritas.", price: 1390000, foto: "costillar" },
          { name: "Parrillada para dos", desc: "Achuras, chorizo, morcilla, vacío y costilla, a la mesa sobre una brasera.", price: 3290000, foto: "parrillada" },
        ],
      },
      {
        name: "Entradas",
        platos: [
          { name: "Empanadas de carne (3 u.)", desc: "Carne cortada a cuchillo, cebolla de verdeo y comino, al horno de barro.", price: 720000 },
          { name: "Tacos de bondiola (3 u.)", desc: "Bondiola braseada, cebolla morada encurtida y salsa de cilantro.", price: 860000, foto: "tacos" },
        ],
      },
      {
        name: "Pastas y pizzas",
        platos: [
          { name: "Penne a la bolognesa", desc: "Pasta al dente con ragú de carne cocinado cuatro horas y queso rallado.", price: 1090000, foto: "penne" },
          { name: "Tagliatelle al ragú", desc: "Pasta fresca de la casa con ragú de falda y hierbas.", price: 1180000, foto: "tagliatelle" },
          { name: "Pizza de la casa", desc: "Masa de fermentación lenta, muzzarella, panceta ahumada, ananá y albahaca.", price: 1240000, foto: "pizza" },
        ],
      },
      {
        name: "De la cocina",
        platos: [
          { name: "Salmón grillado", desc: "Filet de salmón con vegetales salteados y salsa de limón.", price: 1650000, foto: "salmon", tags: [GF] },
          { name: "Bondiola braseada", desc: "Cocida seis horas con manzana y mostaza antigua, con vegetales asados.", price: 1420000, foto: "bondiola" },
          { name: "Hamburguesa con papas", desc: "Doble medallón, cheddar, lechuga y tomate, con papas fritas.", price: 1330000, foto: "burger" },
        ],
      },
      {
        name: "Ensaladas y guarniciones",
        platos: [
          { name: "Ensalada de la casa", desc: "Hojas verdes, zanahoria, aceitunas negras, queso y semillas.", price: 760000, foto: "ensaladaMixta", tags: [VT, GF] },
          { name: "Ensalada de pasta al pesto", desc: "Moños al dente con pesto de albahaca, tomate cherry y parmesano.", price: 840000, foto: "ensaladaPasta", tags: [VT] },
          { name: "Papas rústicas", desc: "Con cáscara, al horno con romero y sal gruesa.", price: 560000, tags: [VG, GF] },
        ],
      },
      {
        name: "Postres",
        platos: [
          { name: "Flan casero con dulce de leche", desc: "Cremoso, con dulce de leche repostero y crema.", price: 640000, tags: [VT, GF] },
          { name: "Copa helada con brownie", desc: "Helado de crema, brownie tibio y salsa de chocolate.", price: 760000, foto: "copa", tags: [VT] },
        ],
      },
      {
        name: "Bebidas",
        platos: [
          { name: "Copa de vino tinto", desc: "Malbec de Mendoza. Consultá la etiqueta del día.", price: 650000, foto: "vino", tags: [VG] },
          { name: "Old fashioned", desc: "Whisky, azúcar, amargo de angostura y cáscara de naranja.", price: 980000, foto: "oldFashioned" },
          { name: "Gin tonic de romero", desc: "Gin, tónica, romero fresco y cáscara de pomelo.", price: 920000, foto: "coctel" },
          { name: "Cóctel de autor", desc: "Pregunta por el cóctel de la semana: cambia con la fruta de estación.", price: 940000, foto: "coctelAutor" },
          { name: "Gaseosa con lima", desc: "Bebida cola con hielo y rodaja de lima.", price: 420000, foto: "gaseosa", tags: [VG, GF] },
        ],
      },
    ],
  },
];

const uuidFrom = (text) => {
  const hex = createHash("md5").update(text).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
const demoId = (prefix, n) => `${prefix}000000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`;
const range = (prefix) => [demoId(prefix, 0), demoId(prefix, 999)];

/** Plan de la organización: ids estables para las filas nuevas y lista de platos del seed que solo reciben foto o texto. */
function plan(def) {
  let c = 0;
  let p = 0;
  let g = 0;
  let o = 0;
  const categorias = [];
  const platos = [];
  const grupos = [];
  const opciones = [];
  def.categorias.forEach((cat, ci) => {
    const catId = cat.id ?? demoId(def.prefix.cat, c++);
    if (!cat.id) categorias.push({ id: catId, organization_id: def.org, name: cat.name, sort_order: ci + (ci > 1 ? 2 : 1), is_active: true });
    cat.platos.forEach((plato, pi) => {
      const id = plato.id ?? demoId(def.prefix.prod, p++);
      platos.push({ ...plato, id, nuevo: !plato.id, catId, sort: pi + 1 });
      for (const grupo of plato.grupos ?? []) {
        const gid = demoId(def.prefix.grp, g++);
        grupos.push({ id: gid, organization_id: def.org, product_id: id, name: grupo.name, min_choices: grupo.min, max_choices: grupo.max, sort_order: grupos.filter((x) => x.product_id === id).length, is_active: true });
        grupo.opciones.forEach(([name, delta], oi) =>
          opciones.push({ id: demoId(def.prefix.opt, o++), organization_id: def.org, group_id: gid, name, price_delta_cents: delta, sort_order: oi, is_active: true }));
      }
    });
  });
  return { categorias, platos, grupos, opciones };
}

async function descargar(fotoId) {
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/${fotoId}.jpg`;
  if (existsSync(file)) return readFileSync(file);
  const response = await fetch(`https://images.unsplash.com/photo-${fotoId}?w=1280&q=80&fm=jpg&fit=max`);
  if (!response.ok) throw new Error(`No se pudo descargar la foto ${fotoId}: ${response.status}`);
  const bytes = await sharp(Buffer.from(await response.arrayBuffer()))
    .rotate()
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  writeFileSync(file, bytes);
  return bytes;
}

const GLIFOS = {
  taza: `<path d="M40 52h40v20a20 20 0 0 1-40 0z"/><path d="M80 56h6a8 8 0 0 1 0 16h-7" fill="none"/><path d="M34 96h52" fill="none"/><path d="M52 40c-4-6 4-8 0-14M66 40c-4-6 4-8 0-14" fill="none"/>`,
  llama: `<path d="M60 22c7 14 22 22 22 42a22 22 0 0 1-44 0c0-9 4-15 9-19 2 8 6 10 9 10-3-13-1-24 4-33z" stroke="none"/>`,
};

async function logo({ fondo, trazo, glifo }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="${fondo}"/><g fill="${trazo}" stroke="${trazo}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${GLIFOS[glifo]}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

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
