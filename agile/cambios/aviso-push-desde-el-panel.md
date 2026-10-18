# Cambio: Aviso de llamados también desde el panel (`/panel/{slug}`)
Estado: implementado y probado en local (segunda versión, con cartel dentro del panel); falta que el usuario lo pruebe y la integración a `main`
Nivel: M (reutiliza el registro, el service worker, las funciones de base y los permisos de [aviso-push-de-llamados](aviso-push-de-llamados.md); no cambia autorización, esquema ni envío)

## Objetivo
*(Corrección del usuario, 2026-10-18, tras probar la primera versión: la idea era poder navegar el panel —por ejemplo, editando la carta— y que si una mesa llama aparezca un aviso arriba, dentro de la pantalla. El aviso del sistema solo no alcanzaba.)*

Que el Dueño y el personal puedan activar el aviso de llamados **desde el panel**, sin entrar a `/sala`, y lo reciban aunque estén en cualquier pantalla del panel (o con el navegador en segundo plano). Que no haya aviso doble si la sala en vivo está abierta y a la vista.

## Decisiones
- **No cambia el envío ni la base:** el push llega al service worker del dispositivo (alcance `/sala/`, archivo `sala-sw.js`) sin importar desde qué página se activó. Registrar el service worker desde `/panel/...` es válido: el alcance es `/sala/` y el encabezado `Service-Worker-Allowed: /sala/` ya lo permite. El registro en el servidor sigue siendo **por local y dispositivo**, así que un dispositivo activado en la sala figura «activado» en el panel y al revés.
- **Una sola implementación:** el bloque de pantalla y el hook `usePush` pasan a `src/components/push/` y los usan la sala y el Resumen del panel. Mismos `data-testid` (`aviso-push`, `push-activo`, `push-ayuda`, `push-error`).
- **Dónde:** en el Resumen (`/panel/{slug}`), arriba de la carta pública. Solo si el servidor tiene `VAPID_PUBLIC_KEY` **y** el plan incluye el llamado (`waiter_call`): con el plan Básico no se ofrece (la función de base lo rechazaría igual).
- **Textos:** en el panel el aviso habla de «llamados» y no de «cerrar la sala» («Avisarme cuando llamen a una mesa» / «Avisos de llamados activados en este dispositivo»).
- **Cartel dentro del panel** (`src/components/panel/llamados-banner.tsx`, montado en `OrgArea` solo para `area="panel"` y con el plan que incluye el llamado): consulta el mismo estado que la sala (`/sala/{slug}/estado`, sesión + RLS, cada ~3 s con la pestaña a la vista, más espaciado oculta o con errores) y muestra arriba, fijo, «Una mesa necesita atención» con las mesas y el tipo, un enlace «Ir a la sala en vivo» y «Ocultar» (oculta las actuales; uno nuevo vuelve a aparecer). Se va solo cuando se atiende en la sala. Sin sonido (para eso está la sala). Deja de consultar si responde 401/404 o `enabled: false`.
- **Aviso doble:** el service worker no muestra el aviso del sistema si una ventana de **esa** sala **o de un panel de ese mismo local** está a la vista **y con foco** (ya se ve: lista o cartel). Con el panel oculto o sin foco, o con otra sala/otro local, se muestra: es preferible un aviso repetido a uno perdido. Con la sala visible pero sin foco (otro monitor), también se muestra.
- **Al tocar el aviso** abre o enfoca la sala (`/sala/{slug}`), también desde el panel.

## Aceptación
- [x] En `/panel/{slug}` con plan Pro y claves VAPID, el Dueño y el Staff ven «Avisarme cuando llamen a una mesa», lo activan (permiso + registro en el servidor), sobrevive a recargar y se puede desactivar.
- [x] El dispositivo activado en la sala figura activado en el panel (mismo local) y no en otro local.
- [x] Con el plan Básico o sin claves VAPID, el Resumen no muestra el bloque.
- [x] El service worker sigue siendo el de alcance `/sala/` (también si se activa desde el panel) y no se usa el de otra app.
- [x] Panel a la vista: aparece el cartel arriba con la mesa y el tipo, sigue al navegar entre pantallas, se puede ocultar y se va al atenderse; otro local, plan Básico y la sala no lo muestran (ni consultan).
- [x] Aviso del sistema: con el panel o la sala de ese local a la vista y con foco no se duplica; con el panel oculto o sin foco, sí.
- [x] 390 px sin desborde en el Resumen; el botón es de 44 px.
- [x] La sala sigue igual (pruebas existentes del aviso, sin cambios).

## Fuera de alcance
- Sonido dentro del panel; iPhone/PWA (ítem propio); activar desde otras pantallas del panel (basta con el Resumen).

## Evidencia
Ejecutado el 2026-10-18 sobre la rama `feat/aviso-push-panel` (base local en seed):
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` **541/541** (nueva: `sala-sw.test.ts`, panel con foco avisa y sala con foco no duplica aunque haya un panel abierto).
- `playwright test e2e/panel-push.spec.ts e2e/sala-push.spec.ts --workers=2`: **15/15** (5 nuevas del panel: Dueño y Staff activan/recargan/desactivan y se suscriben por el service worker de alcance `/sala/`; el dispositivo activado en el panel figura activo en la sala del mismo local y no en otro; permiso bloqueado; plan Básico sin el bloque; 390 px sin desborde). Las 10 de la sala siguen pasando tras mover el bloque y el hook a `src/components/push/`.
- Specs vecinas del panel (`acceso`, `alta-guiada`, `llamado-config`, `sucursales`, `desactivar-sucursales`): **80/80**.
- **Segunda versión (cartel), mismo día:** `pnpm typecheck` y `pnpm lint` OK; `pnpm test` (sala-sw 13/13 con las reglas nuevas del panel); `playwright test e2e/panel-llamados-aviso.spec.ts e2e/panel-push.spec.ts e2e/sala-push.spec.ts --workers=2`: **18/18** (3 nuevas del cartel: aparece arriba al llamar, sigue al navegar, se oculta y reaparece con uno nuevo, desaparece al atenderse, no muestra el de otro local, enlace a la sala sin cartel allí; plan Básico sin cartel ni consultas). Además `acceso`, `llamado-config`, `sala` y `mesas`: 86/86 con un solo fallo de `acceso:82`, que espera el plan Básico y se rompió porque dejé `cafe-ejemplo` en Pro en la base local para la prueba manual (no es una regresión; se corrige con `pnpm db:reset`).
- **No ejecutado:** E2E completo, RLS (no cambia el esquema) y prueba con dispositivo real (el envío no cambia: es el de la sala).
