# Ahora (handoff)

Actualizado: 2026-10-19 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Sin trabajo en curso: el tablero no tiene ítems en curso, seleccionados ni para verificar. Último cierre: [carta en varios idiomas](cambios/carta-en-varios-idiomas.md) (M, [ADR 0023](../docs/decisiones/0023-carta-en-varios-idiomas.md)), aprobada por el usuario e integrada a `main`; el local escribe las traducciones en `/panel/{slug}/carta/traducciones`, sin servicios externos de traducción.

Staging (`https://ucomenu-staging.fly.dev`): migración `20261028100000` aplicada y app desplegada (2026-10-18; `/`, `/login`, `/m/demo/centro` responden 200). La organización `demo` no tiene traducciones cargadas: para ver el selector hay que escribir alguna en el panel de su Dueño.

Claves de staging rotadas (2026-10-19): una clave de servicio se imprimió por error en una sesión; se creó una `sb_secret_` nueva, se cargó en Fly y se **desactivaron las claves heredadas** (`anon`/`service_role` JWT). Staging usa solo `sb_publishable_` y `sb_secret_`. En producción, empezar así.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`). Los textos legales siguen solo en español (la carta traducida enlaza a ellos).
- E2E: usar `--workers=1`. En una corrida completa el servidor de pruebas (`next start`) dejó de responder a mitad y el resto falló por conexión; repetir los archivos restantes en tandas de ~10 pasó todo.
- La corrida completa de RLS falló una vez sin causa conocida; mutaciones: correrlas de ~6 en ~6.
- Límite aceptado de las traducciones: dos personas guardando idiomas distintos de la misma fila en el mismo instante, gana la última.

## Próximo paso

1. Prueba del usuario en un teléfono real contra staging (dos ítems S del [tablero](tablero.md), sección «Mejoras y deuda técnica»): textos legales, alta de una organización desde `/admin`, ticket de visita y pantalla «Llamados».
2. Después, elegir del tablero: pantalla para corregir un pago mal cargado (C), spike de `<model-viewer>` (S) o add-ons y desactivar organizaciones de SuperAdmin (C). Esto último necesita antes que el usuario defina la retención de `price_history` y `payments`. «Sugerir traducción» (DeepL Free o traductor de Chrome) requiere aprobación.
