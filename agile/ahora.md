# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Todo lo pendiente está aprobado, subido a `origin/main` y desplegado en staging (2026-10-21).** Staging (`https://ucomenu-staging.fly.dev`, proyecto de Supabase `ucomenu-staging`) tiene las migraciones hasta `20261107100000` y la app de `main`; `supabase db push --dry-run` dice «up to date». Entró en bloque: borrado de mesas (ADR 0030), cuentas globales (0032), listas, orden e imágenes atómicos (0033), vista por sucursal (0034), carta central con precio, agotado y oculto por sucursal (0035) y las tandas 3 y 4 de UX. El tablero no tiene nada «Para verificar».

**Siguiente trabajo pedido por el usuario: una corrección de UI.** Todavía no se definió cuál; preguntar qué pantalla y qué se ve mal. El diseño vive en `DESIGN.md` y `PRODUCT.md` (skill Impeccable); la carta pública usa el sistema propio dentro de `.carta`, el panel y la sala usan los tokens globales. Una corrección solo visual es nivel S: implementar, comprobar a 390 px sin desborde (`expectNoHorizontalOverflow`) y leer el diff.

Local: `pnpm db:reset` + `pnpm db:demo` + `node tools/escenarios-locales.mjs` (Café Ejemplo con dos sucursales; local, sin versionar) y `pnpm dev`. Usuarios `dueno@cafe-ejemplo.test` y `mozo@cafe-ejemplo.test`, clave `ucomenu-dev-2026`.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal).
- Rollback de `20261107100000`: el código anterior mostraría el historial por sucursal mezclado con el general; los datos se conservan (decisión aceptada, ADR 0035).
- Sin probar: push real y teléfono físico (solo dobles y emulación), lector de pantalla.
- E2E con `--workers=1`; RLS y E2E no a la vez. `pnpm build` antes de `pnpm test:e2e`.

## Próximo paso

1. Preguntar al usuario qué pantalla corregir y con qué criterio.
2. Corregir, probar en local con capturas a 390 px y a escritorio, y mostrar antes de commitear.
3. Cualquier despliegue nuevo a staging pide su aprobación (procedimiento en `docs/produccion.md`, flyctl por Docker).
