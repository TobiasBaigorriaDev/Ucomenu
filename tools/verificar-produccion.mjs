#!/usr/bin/env node
/**
 * Comprueba que las variables de entorno de un despliegue estén bien puestas ANTES de publicar (ficha salida-a-produccion).
 * No llama a ningún servicio: solo lee un archivo de variables (o el entorno actual) y revisa su forma. Nunca imprime
 * el valor de un secreto, solo si está bien o qué le pasa.
 *
 * Uso:
 *   pnpm prod:check --env ruta/al/archivo.env     (formato .env; las variables del proveedor de hosting copiadas a un archivo temporal)
 *   pnpm prod:check                               (revisa el entorno del proceso)
 * Código de salida: 0 sin errores (puede haber avisos), 1 con errores, 2 si no se pudo leer el archivo.
 *
 * El archivo con valores reales de producción NO se versiona: bajalo a un lugar temporal fuera del repositorio y borralo
 * al terminar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|.*\.local|.*\.test)$/i;

const vacio = (valor) => typeof valor !== "string" || valor.trim() === "";

function url(valor) {
  try {
    return new URL(valor.trim());
  } catch {
    return null;
  }
}

/** ¿Parece una clave de servicio de Supabase (la vieja JWT con rol service_role o la nueva sb_secret_)? */
export function pareceClaveDeServicio(valor) {
  const v = (valor ?? "").trim();
  if (v.startsWith("sb_secret_")) return true;
  const partes = v.split(".");
  if (partes.length !== 3) return false;
  try {
    const carga = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return carga?.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * Revisa un entorno (objeto nombre → valor). Devuelve `{ errores, avisos, correctos }`, listas de textos sin secretos.
 * Error = no publicar así. Aviso = revisar a conciencia.
 */
export function evaluarEntorno(env) {
  const errores = [];
  const avisos = [];
  const correctos = [];
  const error = (texto) => errores.push(texto);
  const aviso = (texto) => avisos.push(texto);
  const bien = (texto) => correctos.push(texto);

  // Supabase: proyecto remoto, no el local.
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (vacio(supabaseUrl)) {
    error("NEXT_PUBLIC_SUPABASE_URL: falta.");
  } else {
    const u = url(supabaseUrl);
    if (!u) error("NEXT_PUBLIC_SUPABASE_URL: no es una dirección válida.");
    else if (u.protocol !== "https:" || LOCAL_HOST.test(u.hostname)) {
      error("NEXT_PUBLIC_SUPABASE_URL: tiene que ser https y de un proyecto remoto, no el Supabase local.");
    } else {
      bien("NEXT_PUBLIC_SUPABASE_URL: https y remoto.");
      if (!u.hostname.endsWith(".supabase.co")) aviso("NEXT_PUBLIC_SUPABASE_URL: no termina en .supabase.co (¿dominio propio de Supabase?).");
    }
  }

  const publica = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (vacio(publica)) error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: falta.");
  else if (pareceClaveDeServicio(publica)) error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: es una clave de SERVICIO; llega al navegador y da acceso total.");
  else bien("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: presente y no es de servicio.");

  const servicio = env.SUPABASE_SERVICE_ROLE_KEY;
  if (vacio(servicio)) {
    error("SUPABASE_SERVICE_ROLE_KEY: falta (sin ella no andan la gestión de personal ni /admin).");
  } else {
    bien("SUPABASE_SERVICE_ROLE_KEY: presente.");
    if (!pareceClaveDeServicio(servicio)) aviso("SUPABASE_SERVICE_ROLE_KEY: no parece una clave de servicio (¿se pegó la pública?).");
    // La clave de servicio jamás debe viajar en una variable que llega al navegador.
    const filtradas = Object.entries(env).filter(([nombre, valor]) => nombre.startsWith("NEXT_PUBLIC_") && valor === servicio);
    for (const [nombre] of filtradas) error(`${nombre}: contiene la clave de servicio y llegaría al navegador.`);
  }

  // Secreto del llamado y del ticket de visita.
  const secreto = env.WAITER_CALL_CLIENT_SECRET;
  if (vacio(secreto) || secreto.trim().length < 16) {
    error("WAITER_CALL_CLIENT_SECRET: falta o tiene menos de 16 caracteres; la app usaría uno efímero y los tickets de visita no valdrían entre instancias.");
  } else if (secreto.trim().length < 32) {
    aviso("WAITER_CALL_CLIENT_SECRET: tiene menos de 32 caracteres (se recomienda 32 bytes aleatorios en hexadecimal).");
  } else {
    bien("WAITER_CALL_CLIENT_SECRET: presente y largo.");
  }

  // Aviso de llamados con la pestaña cerrada (Web Push, ADR 0020). Opcional: sin las tres variables queda apagado.
  const vapid = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
  const hayVapid = vapid.some((nombre) => !vacio(env[nombre]));
  if (!hayVapid) {
    aviso("VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY: no están; el aviso con la pestaña cerrada queda apagado (la sala sigue por sondeo). Se generan con `pnpm push:claves`.");
  } else {
    let vapidBien = true;
    if (vacio(env.VAPID_PUBLIC_KEY) || !/^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY.trim())) {
      error("VAPID_PUBLIC_KEY: falta o no tiene el formato de `pnpm push:claves` (87 caracteres base64url); la pantalla ofrecería un aviso que no funciona.");
      vapidBien = false;
    }
    if (vacio(env.VAPID_PRIVATE_KEY) || !/^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY.trim())) {
      error("VAPID_PRIVATE_KEY: falta o no tiene el formato de `pnpm push:claves` (43 caracteres base64url); sin ella no se envía ningún aviso.");
      vapidBien = false;
    } else {
      // La clave privada de push es un secreto de servidor: jamás en una variable que llega al navegador.
      const filtradas = Object.entries(env).filter(([nombre, valor]) => nombre.startsWith("NEXT_PUBLIC_") && valor === env.VAPID_PRIVATE_KEY);
      for (const [nombre] of filtradas) {
        error(`${nombre}: contiene la clave privada de push y llegaría al navegador.`);
        vapidBien = false;
      }
    }
    const contactoPush = env.VAPID_SUBJECT;
    if (!vacio(contactoPush) && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(contactoPush.trim())) {
      error("VAPID_SUBJECT: tiene que ser un `mailto:` o una dirección `https:` (o quedar vacía para usar el correo de contacto).");
      vapidBien = false;
    }
    if (vapidBien) bien("VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY: presentes y con formato correcto (aviso con la pestaña cerrada activo).");
  }

  // Dirección pública (base de los QR impresos).
  const sitio = env.NEXT_PUBLIC_SITE_URL;
  if (vacio(sitio)) {
    error("NEXT_PUBLIC_SITE_URL: falta; el QR impreso apuntaría al dominio desde el que se abrió el panel.");
  } else {
    const u = url(sitio);
    if (!u) error("NEXT_PUBLIC_SITE_URL: no es una dirección válida.");
    else if (u.protocol !== "https:" || LOCAL_HOST.test(u.hostname)) error("NEXT_PUBLIC_SITE_URL: tiene que ser https y el dominio definitivo, no uno local.");
    else {
      bien("NEXT_PUBLIC_SITE_URL: https y no local.");
      if (u.pathname !== "/" || u.search || u.hash) aviso("NEXT_PUBLIC_SITE_URL: tiene ruta o parámetros; tiene que ser solo el dominio.");
      if (/\.(vercel\.app|netlify\.app)$/i.test(u.hostname)) aviso("NEXT_PUBLIC_SITE_URL: es un dominio provisorio del proveedor de hosting; un QR impreso no puede apuntar ahí.");
    }
  }

  // Contacto de la política de privacidad.
  const contacto = env.NEXT_PUBLIC_CONTACT_EMAIL;
  if (vacio(contacto)) error("NEXT_PUBLIC_CONTACT_EMAIL: falta; la política de privacidad no tendría a quién escribirle para ejercer derechos.");
  else if (!EMAIL.test(contacto.trim())) error("NEXT_PUBLIC_CONTACT_EMAIL: no parece un email.");
  else bien("NEXT_PUBLIC_CONTACT_EMAIL: presente.");

  return { errores, avisos, correctos };
}

export function formatear({ errores, avisos, correctos }) {
  const lineas = [];
  for (const t of correctos) lineas.push(`  OK     ${t}`);
  for (const t of avisos) lineas.push(`  AVISO  ${t}`);
  for (const t of errores) lineas.push(`  ERROR  ${t}`);
  lineas.push("");
  lineas.push(errores.length === 0 ? `Sin errores (${avisos.length} aviso${avisos.length === 1 ? "" : "s"}).` : `${errores.length} error${errores.length === 1 ? "" : "es"}: no publicar así.`);
  return lineas.join("\n");
}

export function main(argv, entornoDelProceso = process.env) {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== "--"), // pnpm pasa el "--" tal cual
    options: { env: { type: "string" } },
  });

  let env = entornoDelProceso;
  if (values.env) {
    try {
      env = parseEnv(readFileSync(values.env, "utf8"));
    } catch (e) {
      console.error(`No se pudo leer ${values.env}: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  const resultado = evaluarEntorno(env);
  console.log(formatear(resultado));
  return resultado.errores.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
