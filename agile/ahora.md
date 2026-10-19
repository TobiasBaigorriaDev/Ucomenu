# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Carta en varios idiomas](cambios/carta-en-varios-idiomas.md) (M, [ADR 0023](../docs/decisiones/0023-carta-en-varios-idiomas.md)): aprobada por el usuario e **integrada a `main`** (sin servicios externos de traducción; el local escribe las traducciones en `/panel/{slug}/carta/traducciones`).

Staging (`https://ucomenu-staging.fly.dev`): migración `20261028100000` aplicada y **app desplegada** (2026-10-18, imagen de `main` con `fly deploy` por Docker; `/`, `/login`, `/m/demo/centro` responden 200 y `/panel/demo/carta/traducciones` redirige al login). La organización `demo` no tiene traducciones cargadas: para ver el selector hay que escribir alguna en el panel de su Dueño.

Claves de staging rotadas (2026-10-19): una clave de servicio se imprimió por error en una sesión; se creó una `sb_secret_` nueva, se cargó en Fly y se **desactivaron las claves heredadas** (`anon`/`service_role` JWT). Staging usa solo `sb_publishable_` y `sb_secret_`. En producción, empezar así.

Antes (ya en staging): pagos y auditoría del Dueño, analítica básica, aviso de llamados por Web Push.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`). Los textos legales siguen solo en español (la carta traducida enlaza a ellos).
- E2E: usar `--workers=1`. En la corrida completa de esta tanda el servidor de pruebas (`next start`) dejó de responder a mitad y el resto falló por conexión; repetir los archivos restantes en tandas de ~10 pasó todo.
- La corrida completa de RLS falló una vez sin causa conocida en tandas anteriores; mutaciones: correrlas de ~6 en ~6.
- Límite aceptado de las traducciones: dos personas guardando idiomas distintos de la misma fila en el mismo instante, gana la última.

## Próximo paso

1. Prueba y aprobación del usuario de la carta en varios idiomas.
2. Después, elegir del [tablero](tablero.md): subdominio o dominio propio por organización (M), add-ons y desactivar organizaciones de SuperAdmin (C). Incremento posible sobre este: «sugerir traducción» (DeepL Free o traductor de Chrome; requiere aprobación). La retención de `price_history` necesita política del usuario.
