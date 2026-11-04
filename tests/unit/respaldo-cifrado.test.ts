import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { abrirRespaldo, cifrarRespaldo, claveDeRespaldo } from "../../tools/respaldo-cifrado.mjs";
import { armarManifiesto, sha256, verificarRespaldo } from "../../tools/respaldar.mjs";

const root = mkdtempSync(path.join(tmpdir(), "ucomenu-crypto-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const key = randomBytes(32).toString("hex");
const source = path.join(root, "source");
mkdirSync(source);
const files = { "esquema.sql": "create table synthetic();", "datos.sql": "COPY synthetic;", "storage/product-images/org/foto.png": "FOTO-SINTETICA" };
const entries = Object.entries(files).map(([ruta, data]) => {
  const file = path.join(source, ruta);
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data);
  return { ruta, bytes: Buffer.byteLength(data), sha256: sha256(Buffer.from(data)),
    ...(ruta.startsWith("storage/") ? { bucket: "product-images", objeto: "org/foto.png" } : {}) };
});
writeFileSync(path.join(source, "manifiesto.json"), JSON.stringify(armarManifiesto({ entorno: "local", fecha: new Date(), archivos: entries })));

describe("cifrado de respaldos", () => {
  it("rechaza claves faltantes, contraseñas y tamaños distintos a 256 bits", () => {
    for (const bad of [undefined, "password", "f".repeat(63), "g".repeat(64)]) expect(() => claveDeRespaldo(bad)).toThrow(/32 bytes/);
  });

  it("recupera SQL y Storage idénticos, verifica el manifiesto y conserva el origen", async () => {
    const encrypted = path.join(root, "ok.aes"), opened = path.join(root, "ok");
    await cifrarRespaldo(source, encrypted, key);
    expect(readFileSync(encrypted).includes(Buffer.from("FOTO-SINTETICA"))).toBe(false);
    await abrirRespaldo(encrypted, opened, key);
    expect(verificarRespaldo(opened)).toEqual([]);
    for (const [file, text] of Object.entries(files)) expect(readFileSync(path.join(opened, file), "utf8")).toBe(text);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(encrypted)).toBe(true);
    expect(readdirSync(root).filter((p) => p.startsWith(".descifrado-") || p.startsWith(".cifrado-"))).toEqual([]);
  });

  it("copia repetida usa un IV diferente y no sobrescribe la anterior", async () => {
    const a = path.join(root, "a.aes"), b = path.join(root, "b.aes");
    await cifrarRespaldo(source, a, key); await cifrarRespaldo(source, b, key);
    expect(readFileSync(a).subarray(8, 20).equals(readFileSync(b).subarray(8, 20))).toBe(false);
    const original = readFileSync(a);
    await expect(cifrarRespaldo(source, a, key)).rejects.toThrow();
    expect(readFileSync(a)).toEqual(original);
  });

  it.each(["key", "ciphertext", "tag", "header", "truncated", "half"])("falla cerrado ante %s y no publica ni deja temporales", async (kind) => {
    const encrypted = path.join(root, `${kind}.aes`), opened = path.join(root, `opened-${kind}`);
    await cifrarRespaldo(source, encrypted, key);
    let bytes = readFileSync(encrypted);
    if (kind === "ciphertext") bytes[25] ^= 1;
    if (kind === "tag") bytes[bytes.length - 1] ^= 1;
    if (kind === "header") bytes[10] ^= 1;
    if (kind === "truncated") bytes = bytes.subarray(0, 15);
    if (kind === "half") bytes = bytes.subarray(0, Math.floor(bytes.length / 2));
    writeFileSync(encrypted, bytes);
    await expect(abrirRespaldo(encrypted, opened, kind === "key" ? randomBytes(32).toString("hex") : key)).rejects.toThrow();
    expect(existsSync(opened)).toBe(false);
    expect(readdirSync(root).some((p) => p.startsWith(".descifrado-"))).toBe(false);
  });

  it("no pisa una restauración existente ni acepta un manifiesto corrupto aunque el cifrado sea válido", async () => {
    const encrypted = path.join(root, "existing.aes"), opened = path.join(root, "existing");
    await cifrarRespaldo(source, encrypted, key); mkdirSync(opened);
    writeFileSync(path.join(opened, "conservar"), "original");
    await expect(abrirRespaldo(encrypted, opened, key)).rejects.toThrow(/ya existe/);
    expect(readFileSync(path.join(opened, "conservar"), "utf8")).toBe("original");
    const broken = path.join(root, "broken"); mkdirSync(broken);
    writeFileSync(path.join(broken, "manifiesto.json"), JSON.stringify({ archivos: [{ ruta: "../escape" }] }));
    await expect(cifrarRespaldo(broken, path.join(root, "broken.aes"), key)).rejects.toThrow(/Rutas inválidas/);
    expect(existsSync(path.join(root, "broken.aes"))).toBe(false);
  });
});
