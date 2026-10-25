# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**S3 «Pedidos del mozo»** completa salvo la analítica. **En staging (Fly v51, migraciones hasta `20261202100000`):** anotar, operar, precuenta, la retención ([ADR 0043](../docs/decisiones/0043-retencion-de-pedidos.md), sin ejecutar ni programar), el [turno de mesa](cambios/turno-de-mesa.md) y la [cuenta del comensal](cambios/cuenta-del-comensal.md) ([ADR 0044](../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md)). Cerrar, anular o «Reiniciar QR de la mesa» abre un turno nuevo (el QR impreso no cambia) y el celular anterior pierde la cuenta y los llamados hasta escanear de nuevo.

**Hecho en local, sin desplegar** (feedback del usuario: «al recargar volvían los botones»), commit `faf6c8a`: la visita vive en la URL. Escanear `/t/{token}` redirige a `/t/{token}?v={ticket}` y **recargar reutiliza ese ticket**; con el turno terminado la barra pide escanear de nuevo. Migración **`20261203100000`** (`visit_in_turn`, solo `service_role`), nivel M, sin revisión de Codex. E2E de `/t/`: 174/174. Falta la **aprobación del usuario** para `db push` + `flyctl deploy` (Fly v52). Siguiente migración libre: `20261204100000`. Límite que queda: quien escribe la URL a mano sin `v` recibe una visita nueva.

Los 15 commits locales no se subieron a `origin/main`. Demo en staging: `/m/la-bestia/centro` y `/m/aurelia/centro`, sin Dueño; `demo` de baja: borrarla desde `/admin` desde el 2026-11-23.

## Bloqueos y límites

- Faltan los textos de la cuenta en inglés y portugués en pantalla (sin E2E) y que el usuario pruebe en el teléfono tras cada despliegue.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts`. RLS: `owner-lectura` es intermitente y *workers* con `0xC0000409` se repiten una vez. Con muchos E2E a la vez, `sala.spec`, `llamado-config` y `comentarios-feed` fallan por carga. `tools/escenarios-locales.mjs` es ajeno.
- Decisión abierta: el dock de la mesa parte sus etiquetas en dos líneas a 390 px.

## Próximo paso

1. Con la aprobación: desplegar y probar en el teléfono (escanear, recargar, reiniciar el QR, recargar de nuevo).
2. Decidir si se suben los commits a `origin/main`.
3. Después: programar la purga (`docs/produccion.md` 4.c) y confirmar el plazo con el contador. Urgente: **rotar la `service_role` legacy de staging**.
