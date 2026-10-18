import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Service worker del aviso de llamados (`public/sala-sw.js`, ADR 0020). Se ejecuta en un contexto aislado con un `self`
 * falso: lo que importa es qué muestra, cuándo NO lo duplica y que solo abre rutas de la propia sala.
 */

type Listener = (event: Record<string, unknown>) => void;
type FakeClient = { url: string; visibilityState: string; focused: boolean; focus: ReturnType<typeof vi.fn> };

function loadWorker(clients: FakeClient[]) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async (...args: [url: string]) => void args);
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => clients), openWindow },
    registration: { showNotification },
  };
  const source = readFileSync(path.resolve(import.meta.dirname, "../../public/sala-sw.js"), "utf8");
  vm.runInNewContext(source, { self, URL, JSON });
  return { listeners, showNotification, openWindow, self };
}

const pushEvent = (payload: unknown, raw = false) => {
  const pending: Promise<unknown>[] = [];
  return {
    event: {
      data: { json: () => (raw ? JSON.parse(payload as string) : payload) },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    },
    done: () => Promise.all(pending),
  };
};

const client = (url: string, extra: Partial<FakeClient> = {}): FakeClient => ({
  url,
  visibilityState: "hidden",
  focused: false,
  focus: vi.fn(async () => undefined),
  ...extra,
});

const PAYLOAD = { title: "Llama al mozo", body: "Mesa 4", url: "/sala/cafe", tag: "llamado:cafe:waiter:Mesa 4" };

describe("service worker del aviso de llamados", () => {
  it("muestra la notificación del llamado, que no se cierra sola y reemplaza a la anterior de la misma mesa", async () => {
    const { listeners, showNotification } = loadWorker([]);
    const { event, done } = pushEvent(PAYLOAD);
    listeners.get("push")!(event);
    await done();
    expect(showNotification).toHaveBeenCalledWith("Llama al mozo", {
      body: "Mesa 4",
      tag: "llamado:cafe:waiter:Mesa 4",
      renotify: true,
      requireInteraction: true,
      data: { url: "/sala/cafe" },
    });
  });

  it("no duplica el aviso si esa sala está a la vista y con foco", async () => {
    const { listeners, showNotification } = loadWorker([client("https://app.test/sala/cafe", { visibilityState: "visible", focused: true })]);
    const { event, done } = pushEvent(PAYLOAD);
    listeners.get("push")!(event);
    await done();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it.each([
    ["la pestaña está oculta", { visibilityState: "hidden", focused: false }],
    ["está visible pero sin foco", { visibilityState: "visible", focused: false }],
  ])("sí avisa si %s", async (_nombre, estado) => {
    const { listeners, showNotification } = loadWorker([client("https://app.test/sala/cafe", estado)]);
    const { event, done } = pushEvent(PAYLOAD);
    listeners.get("push")!(event);
    await done();
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("sí avisa si la ventana a la vista es la sala o el panel de OTRO local, o cualquier otra pantalla", async () => {
    const abiertas = [
      client("https://app.test/sala/otro-local", { visibilityState: "visible", focused: true }),
      client("https://app.test/panel/otro-local/carta", { visibilityState: "visible", focused: true }),
      client("https://app.test/panel/cafeteria", { visibilityState: "visible", focused: true }), // mismo prefijo, otro local
      client("https://app.test/login", { visibilityState: "visible", focused: true }),
    ];
    const { listeners, showNotification } = loadWorker(abiertas);
    const { event, done } = pushEvent(PAYLOAD);
    listeners.get("push")!(event);
    await done();
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it.each(["https://app.test/panel/cafe", "https://app.test/panel/cafe/carta"])(
    "con el panel de ese local a la vista y con foco (%s) NO duplica: el cartel del panel ya avisa",
    async (url) => {
      const { listeners, showNotification } = loadWorker([client(url, { visibilityState: "visible", focused: true })]);
      const { event, done } = pushEvent(PAYLOAD);
      listeners.get("push")!(event);
      await done();
      expect(showNotification).not.toHaveBeenCalled();
    },
  );

  it("con el panel oculto o sin foco SÍ avisa", async () => {
    const { listeners, showNotification } = loadWorker([
      client("https://app.test/panel/cafe", { visibilityState: "visible", focused: false }),
      client("https://app.test/panel/cafe/carta", { visibilityState: "hidden", focused: false }),
    ]);
    const { event, done } = pushEvent(PAYLOAD);
    listeners.get("push")!(event);
    await done();
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("un push ilegible o sin datos muestra un aviso genérico (Chrome exige mostrar algo)", async () => {
    const { listeners, showNotification } = loadWorker([]);
    const roto = pushEvent("esto no es json", true);
    listeners.get("push")!(roto.event);
    await roto.done();
    const vacio = { waitUntil: (promise: Promise<unknown>) => promise, data: null };
    await listeners.get("push")!(vacio);
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification.mock.calls[0]).toEqual(["Llamado en la sala", expect.objectContaining({ data: { url: "/sala" } })]);
  });

  it("trata el contenido como no confiable: una ruta ajena se reemplaza por /sala y los textos se acotan", async () => {
    const { listeners, showNotification } = loadWorker([]);
    for (const url of ["https://evil.example/sala/x", "//evil.example", "/panel/cafe", "javascript:alert(1)", "/sala/../admin"]) {
      const { event, done } = pushEvent({ ...PAYLOAD, url, title: "x".repeat(500) });
      listeners.get("push")!(event);
      await done();
    }
    for (const [title, options] of showNotification.mock.calls as unknown as [string, { data: { url: string } }][]) {
      expect(options.data.url).toBe("/sala");
      expect(title.length).toBeLessThanOrEqual(80);
    }
    expect(showNotification).toHaveBeenCalledTimes(5);
  });

  it("al tocar la notificación enfoca la sala abierta en vez de abrir otra", async () => {
    const abierta = client("https://app.test/sala/cafe");
    const { listeners, openWindow } = loadWorker([client("https://app.test/panel/cafe"), abierta]);
    const close = vi.fn();
    const pending: Promise<unknown>[] = [];
    listeners.get("notificationclick")!({ notification: { close, data: { url: "/sala/cafe" } }, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
    expect(close).toHaveBeenCalled();
    expect(abierta.focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("al tocarla sin sala abierta, abre la sala; y nunca una ruta que no sea de la sala", async () => {
    const { listeners, openWindow } = loadWorker([]);
    const click = async (url: unknown) => {
      const pending: Promise<unknown>[] = [];
      listeners.get("notificationclick")!({ notification: { close: vi.fn(), data: { url } }, waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await Promise.all(pending);
    };
    await click("/sala/cafe");
    await click("https://evil.example/");
    await click(undefined);
    expect(openWindow.mock.calls.map((call) => call[0])).toEqual(["/sala/cafe", "/sala", "/sala"]);
  });

  it("no intercepta pedidos: no hay manejador de fetch", () => {
    const { listeners } = loadWorker([]);
    expect([...listeners.keys()].sort()).toEqual(["activate", "install", "notificationclick", "push"]);
  });
});
