# Ahora (handoff)

Actualizado: 2026-10-19 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Sin trabajo en curso: el tablero no tiene ítems en curso, seleccionados ni para verificar. Último cierre: [anular un pago mal cargado](cambios/anular-pagos.md) (C, [ADR 0024](../docs/decisiones/0024-anular-pagos-con-asiento-compensatorio.md)), aprobado por el usuario, en `main` y subido a `origin`. El SuperAdmin anula el último pago vigente desde `/admin/organizaciones/{slug}` con motivo; el vencimiento vuelve al de antes y el Dueño lo ve marcado «Anulado». Corregir = anular + registrar el correcto.

Staging (`https://ucomenu-staging.fly.dev`): migración `20261029100000` aplicada y app desplegada (2026-10-19; rutas públicas 200). Falta que el usuario pruebe la pantalla nueva con su sesión de SuperAdmin en staging. Claves heredadas de Supabase desactivadas (solo `sb_publishable_` y `sb_secret_`; en producción, empezar así). La organización `demo` no tiene traducciones cargadas ni pagos.

Pendiente del usuario: el vencimiento a las 3 h del ticket de visita en teléfono real (lo dejó corriendo la noche del 2026-10-19).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- E2E: usar `--workers=1`; una prueba de suspensión falló una vez y pasó sola. La corrida completa de RLS tarda ~11 min; mutaciones de ~6 en ~6.
- Anular y volver a cargar son dos pasos; entre ambos la cuenta puede quedar vencida. Un solo paso queda como incremento posible.

## Próximo paso

1. Resultado de la prueba de las 3 h del ticket de visita.
2. Elegir del [tablero](tablero.md): spike de `<model-viewer>` (S), o add-ons y desactivar organizaciones de SuperAdmin (C). Esto último necesita antes que el usuario defina la retención de `price_history`, `payments` y `payment_voids`.
