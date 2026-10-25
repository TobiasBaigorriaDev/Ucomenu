# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**S3 «Pedidos del mozo»** completa salvo la analítica. **En staging (Fly v50, migraciones hasta `20261201100000`):** anotar, operar, precuenta, la retención ([ADR 0043](../docs/decisiones/0043-retencion-de-pedidos.md), sin ejecutar ni programar), el [turno de mesa](cambios/turno-de-mesa.md) y la [cuenta del comensal](cambios/cuenta-del-comensal.md) ([ADR 0044](../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md)). Cerrar, anular o «Reiniciar QR de la mesa» abre un turno nuevo (el QR impreso no cambia) y la tarjeta «Pide la cuenta» sale de la Sala.

**Hecho en local, sin desplegar** (feedback del usuario probando en staging, 2026-10-25), aprobado por Codex:
1. «Reiniciar QR» no cortaba los llamados: migración **`20261202100000`** (`create_waiter_call` da `session_closed` si el turno empezó después del ticket, con 1 s de tolerancia). Tras cobrar, quien siga en la mesa debe escanear de nuevo para llamar.
2. La cuenta era ilegible con las paletas oscuras (tinta clara sobre blanco fijo): corregido en `account-sheet.tsx`, con prueba de contraste en todas las paletas.

Falta la **aprobación del usuario** para `db push` y `flyctl deploy` (Fly v51). Siguiente migración libre: `20261203100000`. Los 13 commits locales no se subieron a `origin/main`.

Demo en staging: `/m/la-bestia/centro` y `/m/aurelia/centro`, sin Dueño ([ficha](cambios/demo-en-staging.md)); `demo` de baja: borrarla desde `/admin` desde el 2026-11-23.

## Bloqueos y límites

- Faltan los textos de la cuenta en inglés y portugués en pantalla (sin E2E) y probar cobrar y reescanear en staging tras el despliegue.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts`. RLS: `owner-lectura` es intermitente y *workers* con `0xC0000409` se repiten una vez. Con muchos E2E a la vez, `sala.spec` y `llamado-config` fallan por carga. `tools/escenarios-locales.mjs` es ajeno.
- Decisión abierta: el dock de la mesa parte sus etiquetas en dos líneas a 390 px.

## Próximo paso

1. Con la aprobación: desplegar y probar de nuevo desde el teléfono (reiniciar, cobrar, reescanear, paleta oscura).
2. Decidir si se suben los commits a `origin/main`.
3. Después: programar la purga (`docs/produccion.md` 4.c) y confirmar el plazo con el contador. Urgente: **rotar la `service_role` legacy de staging**.
