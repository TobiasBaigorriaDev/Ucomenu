# Ahora (handoff)

Actualizado: 2026-10-19 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Anular un pago mal cargado](cambios/anular-pagos.md) (C, [ADR 0024](../docs/decisiones/0024-anular-pagos-con-asiento-compensatorio.md)): implementado en `main` (commits `48dc4f6` y `659e750`), probado y revisado por Codex (aprobó en la ronda 2). El SuperAdmin anula el último pago vigente desde `/admin/organizaciones/{slug}` con motivo; el pago queda intacto, el vencimiento vuelve al de antes y el Dueño lo ve marcado «Anulado». Corregir = anular + registrar el correcto. **Falta la prueba y la aprobación del usuario.**

La migración `20261029100000_anular_pagos.sql` está aplicada solo en la base local. **Staging y producción no la tienen:** aplicarla en staging y desplegar necesita aprobación del usuario.

Staging (`https://ucomenu-staging.fly.dev`): carta en varios idiomas desplegada; claves heredadas de Supabase desactivadas (solo `sb_publishable_` y `sb_secret_`; en producción, empezar así). Pruebas en teléfono real de legales, alta desde `/admin` y «Llamados»: bien. Queda una: el vencimiento a las 3 h del ticket de visita (el usuario lo dejó corriendo la noche del 2026-10-19).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- E2E: usar `--workers=1`; una prueba de suspensión falló una vez y pasó sola (ajena). La corrida completa de RLS tarda ~11 min; mutaciones de ~6 en ~6.
- Anular y volver a cargar son dos pasos: entre ambos la cuenta puede quedar vencida. Un solo paso (anular + registrar) queda como incremento posible.

## Próximo paso

1. El usuario prueba la anulación en local (`pnpm db:reset`, `pnpm dev`, `/admin/organizaciones/{slug}` con un pago cargado) y la aprueba; después, con su aprobación, aplicar la migración en staging y desplegar.
2. Resultado de la prueba de las 3 h del ticket de visita.
3. Después, del [tablero](tablero.md): spike de `<model-viewer>` (S), o add-ons y desactivar organizaciones (C; antes el usuario define la retención de `price_history`, `payments` y `payment_voids`).
