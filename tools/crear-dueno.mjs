#!/usr/bin/env node
/**
 * Crea la cuenta del primer Dueño (o de otra persona) de una organización, SOLO EN DESARROLLO LOCAL.
 *
 * Es el reemplazo temporal del alta guiada del SuperAdmin (todavía no existe): las organizaciones y sus
 * primeros dueños se crean desde el servidor, nunca por registro público.
 *
 * Uso (desde la raíz, con el Supabase local encendido: `pnpm db:start`):
 *   pnpm dev:crear-dueno --org cafe-ejemplo --email dueno@mi-local.test --password "una-contraseña-larga"
 *   pnpm dev:crear-dueno --org cafe-ejemplo --email mozo@mi-local.test --password "..." --rol staff
 *   pnpm dev:crear-dueno --org parrilla-demo --email multi@ucomenu.test --existente   # solo suma la membresía
 *
 * Lee NEXT_PUBLIC_SUPABASE_URL de .env.local y SUPABASE_SERVICE_ROLE_KEY de .env.local o .env.test.local.
 * Se niega a correr contra cualquier URL que no sea local: operar contra un proyecto remoto requiere
 * aprobación aparte y un procedimiento propio.
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

for (const file of [".env.local", ".env.test.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Si falta alguno, se avisa abajo por la variable que falte.
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"), // pnpm pasa el "--" tal cual
  options: {
    org: { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
    rol: { type: "string", default: "owner" },
    existente: { type: "boolean", default: false },
  },
});

class Fallo extends Error {}
const salir = (mensaje) => {
  throw new Fallo(mensaje);
};

async function main() {

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) salir("faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (.env.local o .env.test.local).");

  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    salir(`esta herramienta es solo para el Supabase local; la URL configurada apunta a ${host}.`);
  }

  if (!values.org || !values.email) salir("indicá --org <slug> y --email <email>.");
  if (!["owner", "staff"].includes(values.rol)) salir("--rol tiene que ser owner o staff.");
  const email = values.email.trim().toLowerCase();
  if (!values.existente && (!values.password || [...values.password].length < 10)) {
    salir("indicá --password con al menos 10 caracteres (o usá --existente para sumar una cuenta ya creada).");
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const org = await db.from("organizations").select("id, name").eq("slug", values.org).maybeSingle();
  if (org.error) salir(org.error.message);
  if (!org.data) salir(`no existe una organización con slug «${values.org}».`);

  let userId;
  if (values.existente) {
    const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (error) salir(error.message);
    userId = data.users.find((u) => u.email === email)?.id;
    if (!userId) salir(`no existe una cuenta con el email ${email}.`);
  } else {
    const creada = await db.auth.admin.createUser({ email, password: values.password, email_confirm: true });
    if (creada.error || !creada.data.user) {
      salir(
        creada.error?.code === "email_exists"
          ? `el email ${email} ya tiene cuenta; no se modifica. Para sumarla a esta organización usá --existente.`
          : (creada.error?.message ?? "no se pudo crear la cuenta."),
      );
    }
    userId = creada.data.user.id;
  }

  const membresia = await db.from("memberships").insert({ user_id: userId, organization_id: org.data.id, role: values.rol });
  if (membresia.error) {
    if (!values.existente) await db.auth.admin.deleteUser(userId); // no dejar una cuenta huérfana
    salir(`no se pudo crear la membresía: ${membresia.error.message}`);
  }

  console.log(`Listo: ${email} es ${values.rol === "owner" ? "Dueño" : "Personal"} de «${org.data.name}» (${values.org}).`);
}

try {
  await main();
} catch (error) {
  // Sin process.exit(): en Windows cierra mal los sockets abiertos y asusta con un «Assertion failed».
  console.error(error instanceof Fallo ? `Error: ${error.message}` : error);
  process.exitCode = 1;
}
