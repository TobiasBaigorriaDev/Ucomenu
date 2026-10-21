import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Qué dicen y adónde llevan las pantallas de error y de «no encontrado» de cada zona. Lo que importa para quien las lee:
 * un fallo en el panel, la sala o la administración no habla de «la carta» ni pide escanear una mesa, y todas dejan una salida
 * (reintentar o un enlace). Las de la carta pública conservan su mensaje.
 */

vi.mock("next/navigation", () => ({ useParams: () => ({ org: "cafe" }) }));

const render = async (modulo: string, props: Record<string, unknown> = {}) => {
  const { default: Pantalla } = (await import(/* @vite-ignore */ modulo)) as { default: ComponentType<Record<string, unknown>> };
  return renderToStaticMarkup(createElement(Pantalla, { error: new Error("x"), reset: () => undefined, ...props }));
};

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const enlaces = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

const ZONAS = [
  ["panel (dentro del marco)", "@/app/panel/[org]/error", ["/panel/cafe"]],
  ["panel (falla el marco)", "@/app/panel/error", ["/"]],
  ["sala (dentro del marco)", "@/app/sala/[org]/error", ["/panel/cafe"]],
  ["sala (falla el marco)", "@/app/sala/error", ["/"]],
  ["administración", "@/app/admin/error", ["/admin"]],
  ["general", "@/app/error", ["/"]],
] as const;

describe("pantallas de error", () => {
  it.each(ZONAS)("%s: mensaje general, botón para reintentar y una salida", async (_zona, modulo, salidas) => {
    const html = await render(modulo);

    expect(texto(html)).not.toMatch(/carta|QR|mesa/i);
    expect(html).toContain("Reintentar");
    expect(enlaces(html)).toEqual([...salidas]);
  });

  it.each(["@/app/m/error", "@/app/t/error"])("la carta pública (%s) conserva su mensaje", async (modulo) => {
    const html = await render(modulo);

    expect(texto(html)).toContain("No pudimos cargar la carta");
    expect(html).toContain("Reintentar");
  });
});

describe("pantallas de «no encontrado»", () => {
  it.each([
    ["panel (sin marco)", "@/app/panel/not-found", ["/panel", "/"]],
    ["panel (dentro del marco)", "@/app/panel/[org]/not-found", ["/panel/cafe"]],
    ["sala (sin marco)", "@/app/sala/not-found", ["/sala", "/"]],
    ["administración", "@/app/admin/not-found", ["/admin"]],
    ["general", "@/app/not-found", ["/"]],
  ] as const)("%s: no habla de la carta ni de escanear una mesa y lleva a algún lado", async (_zona, modulo, salidas) => {
    const html = await render(modulo);

    expect(texto(html)).not.toMatch(/carta|QR|mesa/i);
    expect(enlaces(html)).toEqual([...salidas]);
  });

  it.each(["@/app/m/not-found", "@/app/t/not-found"])("la carta pública (%s) conserva su mensaje", async (modulo) => {
    expect(texto(await render(modulo))).toContain("No encontramos esta carta");
    expect(texto(await render(modulo))).toContain("código QR de tu mesa");
  });
});
