import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { evaluarEntorno, formatear, pareceClaveDeServicio } from "../../tools/verificar-produccion.mjs";

/** Verificador de entorno de producción (tools/verificar-produccion.mjs): solo mira la forma, sin red. */

const jwt = (role: string) =>
  `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.firma`;

const SERVICIO = "sb_secret_" + "a".repeat(30);
const BUENO: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "b".repeat(20),
  SUPABASE_SERVICE_ROLE_KEY: SERVICIO,
  WAITER_CALL_CLIENT_SECRET: "c".repeat(64),
  NEXT_PUBLIC_SITE_URL: "https://ucomenu.com",
  NEXT_PUBLIC_CONTACT_EMAIL: "hola@ucomenu.com",
  VAPID_PUBLIC_KEY: "B".repeat(87),
  VAPID_PRIVATE_KEY: "p".repeat(43),
};

const con = (cambios: Record<string, string | undefined>) => {
  const env = { ...BUENO, ...cambios };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
};

describe("evaluarEntorno", () => {
  it("un entorno completo y bien formado no da errores ni avisos", () => {
    const r = evaluarEntorno(BUENO);
    expect(r.errores).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.correctos.length).toBe(7);
  });

  it("sin claves de push no es un error: avisa que el aviso con la pestaña cerrada queda apagado", () => {
    const r = evaluarEntorno(con({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined }));
    expect(r.errores).toEqual([]);
    expect(r.avisos.join(" ")).toContain("queda apagado");
  });

  it.each([
    ["falta la privada", { VAPID_PRIVATE_KEY: undefined }, "VAPID_PRIVATE_KEY"],
    ["falta la pública", { VAPID_PUBLIC_KEY: undefined }, "VAPID_PUBLIC_KEY"],
    ["pública con mal formato", { VAPID_PUBLIC_KEY: "corta" }, "VAPID_PUBLIC_KEY"],
    ["privada con mal formato", { VAPID_PRIVATE_KEY: "corta" }, "VAPID_PRIVATE_KEY"],
    ["contacto inválido", { VAPID_SUBJECT: "ftp://x" }, "VAPID_SUBJECT"],
    ["la privada en una variable pública", { NEXT_PUBLIC_CONTACT_EMAIL: "p".repeat(43) }, "llegaría al navegador"],
  ])("claves de push a medias o mal puestas: %s", (_nombre, cambios, texto) => {
    const r = evaluarEntorno(con(cambios));
    expect(r.errores.join(" ")).toContain(texto);
  });

  it.each([
    ["falta la URL de Supabase", { NEXT_PUBLIC_SUPABASE_URL: undefined }, "NEXT_PUBLIC_SUPABASE_URL"],
    ["Supabase local", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, "NEXT_PUBLIC_SUPABASE_URL"],
    ["Supabase por http", { NEXT_PUBLIC_SUPABASE_URL: "http://abcdefgh.supabase.co" }, "NEXT_PUBLIC_SUPABASE_URL"],
    ["falta la clave pública", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    ["la clave pública es de servicio (nueva)", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SERVICIO }, "es una clave de SERVICIO"],
    ["la clave pública es de servicio (JWT)", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }, "es una clave de SERVICIO"],
    ["falta la clave de servicio", { SUPABASE_SERVICE_ROLE_KEY: undefined }, "SUPABASE_SERVICE_ROLE_KEY"],
    ["la clave de servicio en una variable pública", { NEXT_PUBLIC_CONTACT_EMAIL: SERVICIO }, "llegaría al navegador"],
    ["falta el secreto del llamado", { WAITER_CALL_CLIENT_SECRET: undefined }, "WAITER_CALL_CLIENT_SECRET"],
    ["secreto de menos de 16 caracteres", { WAITER_CALL_CLIENT_SECRET: "corto" }, "efímero"],
    ["falta la dirección pública", { NEXT_PUBLIC_SITE_URL: undefined }, "NEXT_PUBLIC_SITE_URL"],
    ["dirección pública local", { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, "NEXT_PUBLIC_SITE_URL"],
    ["dirección pública por http", { NEXT_PUBLIC_SITE_URL: "http://ucomenu.com" }, "NEXT_PUBLIC_SITE_URL"],
    ["falta el email de contacto", { NEXT_PUBLIC_CONTACT_EMAIL: undefined }, "NEXT_PUBLIC_CONTACT_EMAIL"],
    ["email de contacto inválido", { NEXT_PUBLIC_CONTACT_EMAIL: "no-es-un-email" }, "no parece un email"],
  ])("error: %s", (_etiqueta, cambios, texto) => {
    const r = evaluarEntorno(con(cambios));
    expect(r.errores.join("\n")).toContain(texto);
  });

  it.each([
    ["secreto de entre 16 y 31 caracteres", { WAITER_CALL_CLIENT_SECRET: "d".repeat(20) }, "menos de 32"],
    ["dirección pública con ruta", { NEXT_PUBLIC_SITE_URL: "https://ucomenu.com/panel" }, "ruta o parámetros"],
    ["dirección provisoria de Vercel", { NEXT_PUBLIC_SITE_URL: "https://ucomenu-git-main.vercel.app" }, "provisorio"],
    ["dirección provisoria de Netlify", { NEXT_PUBLIC_SITE_URL: "https://ucomenu.netlify.app" }, "provisorio"],
    ["Supabase fuera de supabase.co", { NEXT_PUBLIC_SUPABASE_URL: "https://db.ucomenu.com" }, ".supabase.co"],
  ])("aviso (no error): %s", (_etiqueta, cambios, texto) => {
    const r = evaluarEntorno(con(cambios));
    expect(r.errores).toEqual([]);
    expect(r.avisos.join("\n")).toContain(texto);
  });

  it("nunca incluye el valor de un secreto en lo que informa", () => {
    const secreto = "s3cr3to-" + "z".repeat(40);
    const r = evaluarEntorno(con({ WAITER_CALL_CLIENT_SECRET: secreto, NEXT_PUBLIC_CONTACT_EMAIL: SERVICIO }));
    const texto = formatear(r);
    expect(texto).not.toContain(secreto);
    expect(texto).not.toContain(SERVICIO);
  });
});

describe("pareceClaveDeServicio", () => {
  it("reconoce las dos formas y no confunde la pública", () => {
    expect(pareceClaveDeServicio("sb_secret_abc")).toBe(true);
    expect(pareceClaveDeServicio(jwt("service_role"))).toBe(true);
    expect(pareceClaveDeServicio(jwt("anon"))).toBe(false);
    expect(pareceClaveDeServicio("sb_publishable_abc")).toBe(false);
    expect(pareceClaveDeServicio(undefined)).toBe(false);
    expect(pareceClaveDeServicio("a.b.c")).toBe(false);
  });
});

describe("pnpm prod:check (línea de comandos)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "prod-check-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const script = path.resolve("tools/verificar-produccion.mjs");
  const correr = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv });
  const escribir = (nombre: string, env: Record<string, string>) => {
    const archivo = path.join(dir, nombre);
    writeFileSync(archivo, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n"));
    return archivo;
  };

  it("sale con 0 si el archivo está bien", () => {
    const r = correr("--env", escribir("bien.env", BUENO));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Sin errores");
  });

  it("sale con 1 si hay errores y no imprime el secreto", () => {
    const r = correr("--env", escribir("mal.env", { ...BUENO, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ERROR  NEXT_PUBLIC_SITE_URL");
    expect(r.stdout).not.toContain(SERVICIO);
  });

  it("sale con 2 si el archivo no existe", () => {
    const r = correr("--env", path.join(dir, "no-existe.env"));
    expect(r.status).toBe(2);
  });

  it("sin archivo revisa el entorno del proceso (vacío: errores)", () => {
    expect(correr().status).toBe(1);
  });
});
