/*
 * Service worker del aviso de llamados con la pestaña cerrada (Web Push; ADR 0020, ficha aviso-push-de-llamados).
 *
 * Solo hace dos cosas: mostrar la notificación cuando el servidor manda un push y abrir (o enfocar) la sala al tocarla.
 * No guarda nada en caché ni intercepta pedidos (no hay manejador de `fetch`). El texto viaja cifrado de punta a punta;
 * esto lo trata como datos no confiables: solo muestra textos cortos y solo abre rutas de la propia sala.
 * Se prueba en tests/unit/sala-sw.test.ts.
 */

var SALA_PATH = /^\/sala(\/[a-z0-9-]+)?$/;
var FALLBACK = { title: "Llamado en la sala", body: "Abrí la sala para ver quién necesita atención.", url: "/sala", tag: "llamado" };

function text(value, fallback, max) {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : fallback;
}

function readPayload(event) {
  try {
    var data = event.data ? event.data.json() : null;
    if (!data || typeof data !== "object") return FALLBACK;
    var url = typeof data.url === "string" && SALA_PATH.test(data.url) ? data.url : FALLBACK.url;
    return {
      title: text(data.title, FALLBACK.title, 80),
      body: text(data.body, FALLBACK.body, 160),
      url: url,
      tag: text(data.tag, FALLBACK.tag, 120),
    };
  } catch {
    return FALLBACK;
  }
}

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var data = readPayload(event);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
      // Si esa sala está a la vista y con foco, ya suena y se ve sola (sondeo): no se duplica el aviso. Con la pestaña
      // oculta, en segundo plano o sin foco, SIEMPRE se muestra: es mejor un aviso repetido que uno perdido.
      var watching = windows.some(function (client) {
        return client.visibilityState === "visible" && client.focused === true && new URL(client.url).pathname === data.url;
      });
      if (watching) return undefined;
      return self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        renotify: true,
        requireInteraction: true,
        data: { url: data.url },
      });
    }),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var stored = event.notification.data && event.notification.data.url;
  var path = typeof stored === "string" && SALA_PATH.test(stored) ? stored : FALLBACK.url;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i += 1) {
        if (new URL(windows[i].url).pathname === path && "focus" in windows[i]) return windows[i].focus();
      }
      return self.clients.openWindow(path);
    }),
  );
});
