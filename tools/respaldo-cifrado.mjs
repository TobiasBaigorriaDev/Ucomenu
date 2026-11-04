// Formato v1: magic (8), IV aleatorio (12), contenido tar.gz cifrado, tag GCM (16).
// AES-GCM autentica el encabezado y el archivo completo antes de extraer un solo dato.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, appendFileSync, closeSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, linkSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

const MAGIC = Buffer.from("UCOMENU1");
const HEADER_SIZE = 20;
const TAG_SIZE = 16;

export function claveDeRespaldo(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("RESPALDO_ENCRYPTION_KEY debe ser una clave aleatoria de 32 bytes en hexadecimal, guardada fuera de Git.");
  }
  return Buffer.from(value, "hex");
}

function ejecutarTar(args) {
  const r = spawnSync("tar", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error("No se pudo procesar el archivo tar del respaldo.");
  return r.stdout;
}

function archivosRegulares(dir) {
  for (const entry of readdirSync(dir)) {
    const child = path.join(dir, entry);
    const info = lstatSync(child);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error("No se admiten enlaces ni archivos especiales.");
    if (info.isDirectory()) archivosRegulares(child);
  }
}

async function descifrarArchivo(source, target, key) {
  const size = statSync(source).size;
  if (size <= HEADER_SIZE + TAG_SIZE) throw new Error("Respaldo cifrado incompleto.");
  const fd = openSync(source, "r");
  const header = Buffer.alloc(HEADER_SIZE), tag = Buffer.alloc(TAG_SIZE);
  try { readSync(fd, header, 0, header.length, 0); readSync(fd, tag, 0, tag.length, size - TAG_SIZE); }
  finally { closeSync(fd); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error("Formato de respaldo desconocido.");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8), { authTagLength: TAG_SIZE });
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(source, { start: HEADER_SIZE, end: size - TAG_SIZE - 1 }),
      decipher, createWriteStream(target, { flags: "wx", mode: 0o600 }));
  } catch {
    throw new Error("No se pudo autenticar el respaldo: clave incorrecta o archivo alterado.");
  }
}

export async function cifrarRespaldo(source, target, keyHex) {
  const key = claveDeRespaldo(keyHex);
  archivosRegulares(source);
  const work = mkdtempSync(path.join(path.dirname(target), ".cifrado-"));
  try {
    const packed = path.join(work, "copia.tar.gz");
    const encrypted = path.join(work, "copia.aes");
    ejecutarTar(["-czf", packed, "-C", source, "."]);
    const header = Buffer.concat([MAGIC, randomBytes(12)]);
    writeFileSync(encrypted, header, { flag: "wx", mode: 0o600 });
    const cipher = createCipheriv("aes-256-gcm", key, header.subarray(8));
    cipher.setAAD(header);
    await pipeline(createReadStream(packed), cipher, createWriteStream(encrypted, { flags: "a" }));
    appendFileSync(encrypted, cipher.getAuthTag());
    // Verifica la autenticación y la recuperación antes de declarar la copia lista.
    const checked = path.join(work, "verificado.tar.gz");
    await descifrarArchivo(encrypted, checked, key);
    const { createHash } = await import("node:crypto");
    const digest = async (file) => {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      return hash.digest("hex");
    };
    if (await digest(packed) !== await digest(checked)) throw new Error("La verificación de descifrado no coincide.");
    // Publicación atómica sin sobrescritura, mismo volumen que el directorio temporal.
    linkSync(encrypted, target);
  } finally {
    key.fill(0);
    // Solo el directorio recién creado por mkdtemp, nunca el source del usuario.
    rmSync(work, { recursive: true, force: true });
  }
}

const rutaSegura = (ruta) => typeof ruta === "string" && ruta.length > 0 &&
  !ruta.includes("\\") && !ruta.includes(":") && !ruta.includes("\0") &&
  !path.posix.isAbsolute(ruta) && ruta.split("/").every((p) => p !== ".." && p !== "." && p !== "");

async function extraerArchivo(archive, entry, target) {
  // tar solo escribe a stdout: un enlace/path del archivo nunca controla el destino en disco.
  const child = spawn("tar", ["-xOzf", archive, `./${entry}`], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("No se pudo extraer un archivo del respaldo.")));
  });
  try {
    await Promise.all([done, pipeline(child.stdout, createWriteStream(target, { flags: "wx", mode: 0o600 }))]);
  } catch (error) { child.kill(); throw error; }
}

export async function abrirRespaldo(source, target, keyHex) {
  const key = claveDeRespaldo(keyHex);
  const parent = path.dirname(path.resolve(target));
  const work = mkdtempSync(path.join(parent, ".descifrado-"));
  try {
    // No reemplazar un destino ni seguir enlaces existentes.
    try { lstatSync(target); throw new Error("El destino ya existe."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const archive = path.join(work, "autenticado.tar.gz");
    await descifrarArchivo(source, archive, key);
    const raw = ejecutarTar(["-xOzf", archive, "./manifiesto.json"]);
    const manifest = JSON.parse(raw);
    if (!Array.isArray(manifest.archivos)) throw new Error("Manifiesto inválido.");
    const entries = manifest.archivos.map((a) => a.ruta);
    if (entries.some((p) => !rutaSegura(p)) || new Set(entries).size !== entries.length || entries.includes("manifiesto.json")) {
      throw new Error("Rutas inválidas en el manifiesto.");
    }
    const restored = path.join(work, "copia");
    mkdirSync(restored, { mode: 0o700 });
    writeFileSync(path.join(restored, "manifiesto.json"), raw, { flag: "wx", mode: 0o600 });
    for (const entry of entries) {
      const destination = path.join(restored, ...entry.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      await extraerArchivo(archive, entry, destination);
    }
    const { verificarRespaldo } = await import("./respaldar.mjs");
    if (verificarRespaldo(restored).length) throw new Error("El respaldo recuperado no pasa la verificación del manifiesto.");
    // El padre está en el mismo volumen; el destino se publica solo después de autenticar y verificar.
    renameSync(restored, target);
  } finally {
    key.fill(0);
    rmSync(work, { recursive: true, force: true });
  }
}

export async function main(argv) {
  try {
    const { values } = parseArgs({ args: argv.filter((a) => a !== "--"), options: {
      archivo: { type: "string" }, destino: { type: "string" }, env: { type: "string" },
    } });
    if (!values.archivo || !values.destino || !values.env) throw new Error("Usá --archivo <copia.aes> --destino <carpeta nueva> --env <archivo fuera de Git>.");
    const { validarDestino } = await import("./respaldar.mjs");
    const target = validarDestino(values.destino);
    const env = parseEnv(readFileSync(values.env, "utf8"));
    await abrirRespaldo(values.archivo, target, env.RESPALDO_ENCRYPTION_KEY);
    console.log("Copia descifrada y manifiesto verificado. El origen cifrado se conserva.");
    return 0;
  } catch (error) { console.error(error.message); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
