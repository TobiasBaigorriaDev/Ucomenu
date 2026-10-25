# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**S3 «Pedidos del mozo»** completa salvo la analítica; en staging (Fly 49, migración `20261129100000`): anotar, operar, precuenta y la función de retención ([ADR 0043](../docs/decisiones/0043-retencion-de-pedidos.md), no se ejecuta ni se programa).

**Hecho en local, sin subir ni desplegar** (10 commits adelante de `origin/main`, hasta `1377409`): [turno de mesa](cambios/turno-de-mesa.md) y [cuenta del comensal](cambios/cuenta-del-comensal.md), [ADR 0044](../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md). El QR impreso no cambia; cerrar, anular o «Reiniciar QR de la mesa» abre un turno nuevo y el celular anterior pierde la cuenta. Aprobados por Codex (2 y 4 rondas). Migraciones **`20261130100000` y `20261201100000` NO aplicadas en staging**; siguiente libre: `20261202100000`. La tarjeta «Pide la cuenta» ahora sale sola de la Sala al cobrar.

Demo en staging: `/m/la-bestia/centro` y `/m/aurelia/centro`, sin Dueño ([ficha](cambios/demo-en-staging.md)). `demo` de baja: borrarla desde `/admin` desde el 2026-11-23.

## Bloqueos y límites

- Falta la **aprobación del usuario** para aplicar las dos migraciones en staging y desplegar.
- Claves de Supabase de staging: Fly usa la `default`. Falta probar todo con sesión real (SuperAdmin, personal, llamados).
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). RLS completa: 3 fallos identificados en la [ficha](cambios/cuenta-del-comensal.md#evidencia) (uno actualizado, dos intermitentes de tablas globales). Con muchos E2E a la vez, `sala.spec` y `llamado-config` fallan por carga. `tools/escenarios-locales.mjs` es ajeno.
- Decisión abierta: el dock de la mesa parte sus etiquetas en dos líneas a 390 px.

## Próximo paso

1. Pedir la aprobación y aplicar las dos migraciones en staging, desplegar en Fly y probar con un local Pro con Dueño: pedir la cuenta, ver la cuenta, cobrar, reescanear y reiniciar desde la Sala; mirar los textos en inglés y portugués.
2. Después: programar la purga (`docs/produccion.md` 4.c) y confirmar el plazo con el contador. Pendiente urgente: **rotar la `service_role` legacy de staging**.
