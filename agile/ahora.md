# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Rama **`feat/carta-multiidioma`** (sin integrar a `main`): [Carta en varios idiomas](cambios/carta-en-varios-idiomas.md) (M, [ADR 0023](../docs/decisiones/0023-carta-en-varios-idiomas.md)), implementada y verificada (lint, typecheck, build, unitarias, RLS y E2E; evidencia en la ficha). El local escribe las traducciones al inglés y portugués en `/panel/{slug}/carta/traducciones`; la carta ofrece el selector al cargar el primer texto, entra en el idioma del navegador y cae al español campo por campo. Sin servicios externos de traducción.

Falta: **que el usuario la pruebe** (con `pnpm db:reset`, `pnpm build` y `pnpm start`, o `pnpm dev`; cargar unas traducciones en el panel del Dueño de `cafe-ejemplo` y abrir `/m/cafe-ejemplo/centro?lang=en`). Si la aprueba: integrar a `main`, pasar el ítem a «Hecho» y, con aprobación, aplicar la migración `20261028100000` en staging.

Antes (ya en `main` y desplegado a staging, migraciones hasta `20261027100000`): pagos y auditoría del Dueño, analítica básica, aviso de llamados por Web Push. `main` está varios commits por delante de `origin`: **falta el push** (no se pidió).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`). Los textos legales siguen solo en español (la carta traducida enlaza a ellos).
- E2E: usar `--workers=1`. En la corrida completa de esta tanda el servidor de pruebas (`next start`) dejó de responder a mitad y el resto falló por conexión; repetir los archivos restantes en tandas de ~10 pasó todo.
- La corrida completa de RLS falló una vez sin causa conocida en tandas anteriores; mutaciones: correrlas de ~6 en ~6.
- Límite aceptado de las traducciones: dos personas guardando idiomas distintos de la misma fila en el mismo instante, gana la última.

## Próximo paso

1. Prueba y aprobación del usuario de la carta en varios idiomas.
2. Después, elegir del [tablero](tablero.md): subdominio o dominio propio por organización (M), add-ons y desactivar organizaciones de SuperAdmin (C). Incremento posible sobre este: «sugerir traducción» (DeepL Free o traductor de Chrome; requiere aprobación). La retención de `price_history` necesita política del usuario.
