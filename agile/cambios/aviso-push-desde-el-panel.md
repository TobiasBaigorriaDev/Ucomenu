# Cambio: Aviso de llamados también desde el panel (`/panel/{slug}`)
Estado: implementado y probado en local; falta que el usuario lo pruebe en un dispositivo y la integración a `main`
Nivel: M (reutiliza el registro, el service worker, las funciones de base y los permisos de [aviso-push-de-llamados](aviso-push-de-llamados.md); no cambia autorización, esquema ni envío)

## Objetivo
Que el Dueño y el personal puedan activar el aviso de llamados **desde el panel**, sin entrar a `/sala`, y lo reciban aunque estén en cualquier pantalla del panel (o con el navegador en segundo plano). Que no haya aviso doble si la sala en vivo está abierta y a la vista.

## Decisiones
- **No cambia el envío ni la base:** el push llega al service worker del dispositivo (alcance `/sala/`, archivo `sala-sw.js`) sin importar desde qué página se activó. Registrar el service worker desde `/panel/...` es válido: el alcance es `/sala/` y el encabezado `Service-Worker-Allowed: /sala/` ya lo permite. El registro en el servidor sigue siendo **por local y dispositivo**, así que un dispositivo activado en la sala figura «activado» en el panel y al revés.
- **Una sola implementación:** el bloque de pantalla y el hook `usePush` pasan a `src/components/push/` y los usan la sala y el Resumen del panel. Mismos `data-testid` (`aviso-push`, `push-activo`, `push-ayuda`, `push-error`).
- **Dónde:** en el Resumen (`/panel/{slug}`), arriba de la carta pública. Solo si el servidor tiene `VAPID_PUBLIC_KEY` **y** el plan incluye el llamado (`waiter_call`): con el plan Básico no se ofrece (la función de base lo rechazaría igual).
- **Textos:** en el panel el aviso habla de «llamados» y no de «cerrar la sala» («Avisarme cuando llamen a una mesa» / «Avisos de llamados activados en este dispositivo»).
- **Aviso doble:** se mantiene la regla ya revisada del service worker: no se muestra solo si una ventana de **esa** sala está a la vista **y con foco**. Con el panel a la vista y con foco, el aviso **sí** se muestra (el panel no suena ni sondea). Con la sala visible pero sin foco (p. ej. en otro monitor mientras se trabaja en el panel), se muestra: es preferible un aviso repetido a uno perdido.
- **Al tocar el aviso** abre o enfoca la sala (`/sala/{slug}`), también desde el panel.

## Aceptación
- [x] En `/panel/{slug}` con plan Pro y claves VAPID, el Dueño y el Staff ven «Avisarme cuando llamen a una mesa», lo activan (permiso + registro en el servidor), sobrevive a recargar y se puede desactivar.
- [x] El dispositivo activado en la sala figura activado en el panel (mismo local) y no en otro local.
- [x] Con el plan Básico o sin claves VAPID, el Resumen no muestra el bloque.
- [x] El service worker sigue siendo el de alcance `/sala/` (también si se activa desde el panel) y no se usa el de otra app.
- [x] Panel a la vista y con foco: el aviso se muestra. Sala a la vista y con foco: no se duplica.
- [x] 390 px sin desborde en el Resumen; el botón es de 44 px.
- [x] La sala sigue igual (pruebas existentes del aviso, sin cambios).

## Fuera de alcance
- Aviso sonoro o sondeo dentro del panel; iPhone/PWA (ítem propio); activar desde otras pantallas del panel (basta con el Resumen).

## Evidencia
Ejecutado el 2026-10-18 sobre la rama `feat/aviso-push-panel` (base local en seed):
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` **541/541** (nueva: `sala-sw.test.ts`, panel con foco avisa y sala con foco no duplica aunque haya un panel abierto).
- `playwright test e2e/panel-push.spec.ts e2e/sala-push.spec.ts --workers=2`: **15/15** (5 nuevas del panel: Dueño y Staff activan/recargan/desactivan y se suscriben por el service worker de alcance `/sala/`; el dispositivo activado en el panel figura activo en la sala del mismo local y no en otro; permiso bloqueado; plan Básico sin el bloque; 390 px sin desborde). Las 10 de la sala siguen pasando tras mover el bloque y el hook a `src/components/push/`.
- Specs vecinas del panel (`acceso`, `alta-guiada`, `llamado-config`, `sucursales`, `desactivar-sucursales`): **80/80**.
- **No ejecutado:** E2E completo, RLS (no cambia el esquema) y prueba con dispositivo real (el envío no cambia: es el de la sala).
