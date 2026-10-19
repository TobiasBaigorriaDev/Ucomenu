# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Carta en varios idiomas](cambios/carta-en-varios-idiomas.md) (M, [ADR 0023](../docs/decisiones/0023-carta-en-varios-idiomas.md)): aprobada por el usuario e **integrada a `main`** (sin servicios externos de traducción; el local escribe las traducciones en `/panel/{slug}/carta/traducciones`).

Falta, en staging (`https://ucomenu-staging.fly.dev`, migraciones hasta `20261027100000`):
1. **Aplicar la migración `20261028100000`**: el usuario la aprobó, pero el control de permisos bloqueó `supabase db push` al agente. La corre el usuario: `pnpm exec supabase db push --dry-run` y luego `pnpm exec supabase db push` (proyecto enlazado `oasixhsdyigimwvcxtkx`). Es aditiva; el código viejo la ignora.
2. **Desplegar la app** a staging (Fly, `docs/produccion.md` paso 3b) cuando la migración esté aplicada; sin ella el código nuevo falla al leer `translations`. No se pidió ni se hizo.

Antes (ya en staging): pagos y auditoría del Dueño, analítica básica, aviso de llamados por Web Push.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`). Los textos legales siguen solo en español (la carta traducida enlaza a ellos).
- E2E: usar `--workers=1`. En la corrida completa de esta tanda el servidor de pruebas (`next start`) dejó de responder a mitad y el resto falló por conexión; repetir los archivos restantes en tandas de ~10 pasó todo.
- La corrida completa de RLS falló una vez sin causa conocida en tandas anteriores; mutaciones: correrlas de ~6 en ~6.
- Límite aceptado de las traducciones: dos personas guardando idiomas distintos de la misma fila en el mismo instante, gana la última.

## Próximo paso

1. Prueba y aprobación del usuario de la carta en varios idiomas.
2. Después, elegir del [tablero](tablero.md): subdominio o dominio propio por organización (M), add-ons y desactivar organizaciones de SuperAdmin (C). Incremento posible sobre este: «sugerir traducción» (DeepL Free o traductor de Chrome; requiere aprobación). La retención de `price_history` necesita política del usuario.
