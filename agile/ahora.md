# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**S3 «Pedidos del mozo»** completa salvo la analítica. **En staging (Fly v50, migraciones hasta `20261201100000`):** anotar, operar, precuenta, la función de retención ([ADR 0043](../docs/decisiones/0043-retencion-de-pedidos.md), no se ejecuta ni se programa), el [turno de mesa](cambios/turno-de-mesa.md) y la [cuenta del comensal](cambios/cuenta-del-comensal.md) ([ADR 0044](../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md)).

El QR impreso no cambia: cerrar, anular o «Reiniciar QR de la mesa» abre un turno nuevo y el celular anterior pierde la cuenta. Tras «Pedir la cuenta» el comensal ve «Ver mi cuenta». Cerrar la mesa hace salir de la Sala la tarjeta «Pide la cuenta». Aprobados por Codex (2 y 4 rondas) y desplegados el 2026-10-25 con aprobación del usuario.

**Pendiente de desplegar (feedback del usuario en staging, 2026-10-25):** (1) «Reiniciar QR» no cortaba los llamados: migración **`20261202100000`** (`create_waiter_call` responde `session_closed` si el turno empezó después del ticket; aprobada por Codex), y (2) la cuenta era ilegible con las paletas oscuras (corregida en `account-sheet.tsx`, con prueba de contraste en todas las paletas). Esperan la aprobación del usuario para `db push` + `flyctl deploy` (Fly v51). Siguiente migración libre: `20261203100000`.

**Los commits locales no se subieron a `origin/main`** (13 adelante). Demo en staging: `/m/la-bestia/centro` y `/m/aurelia/centro`, sin Dueño ([ficha](cambios/demo-en-staging.md)); `demo` de baja: borrarla desde `/admin` desde el 2026-11-23.

## Bloqueos y límites

- **Nada de esto se probó con sesión real** en staging (los demos no tienen Dueño): hace falta un local Pro con Dueño, y mirar los textos en inglés y portugués (sin E2E).
- Claves de Supabase de staging: Fly usa la `default`. Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). RLS completa: `billing` y `owner-lectura` son intermitentes por tablas globales (pasan solas). Con muchos E2E a la vez, `sala.spec` y `llamado-config` fallan por carga. `tools/escenarios-locales.mjs` es ajeno.
- Decisión abierta: el dock de la mesa parte sus etiquetas en dos líneas a 390 px.

## Próximo paso

1. Probar en staging con un local Pro con Dueño: pedir la cuenta, ver la cuenta, cobrar, reescanear y reiniciar el QR desde la Sala.
2. Decidir si se suben los commits a `origin/main`.
3. Después: programar la purga (`docs/produccion.md` 4.c) y confirmar el plazo con el contador. Pendiente urgente: **rotar la `service_role` legacy de staging**.
