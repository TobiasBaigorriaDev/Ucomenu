# Ahora (handoff)

Actualizado: 2026-10-31 · agente saliente: Claude.

## Punto de retomada

**Rama `main`, base `b49ed9d` (= `origin/main`), con cambios locales sin commit** que cierran la revisión de preparación para producción (veredicto de esa revisión: **no listo** hasta crear producción y resolver lo legal):

- **Precios en pesos [C]** ([ficha](cambios/precios-en-pesos.md)): catálogo y portada en ARS (Pro anual 278.400; Premium sin precio de lista), migración `20261216100000` **solo en local** (la siguiente libre es `20261217100000`). Falta revisión independiente (`pnpm revision:codex`) y tu aprobación para staging; la app anterior no lee los nombres nuevos, así que migración y despliegue van juntos.
- **Cierre de la revisión [M]** ([ficha](cambios/cierre-revision-de-lanzamiento.md)): textos legales (reservas, Gemini, gracia, baja, plazos), cabeceras de seguridad y `robots.txt`, avisos de `prod:check`, `docs/produccion.md` (Mux, reinicio de QR, limpieza de `pg_cron`, monitoreo) y recomendación de respaldos (`docs/operacion.md`).

Verificado en local: 1386 unitarias, lint, typecheck, build, 45 E2E y 244 RLS enfocadas. No corrió la suite RLS completa.

**Sin commit a propósito (de antes):** `video/`, `.codegraph/`, `tools/demo-portada/mis-capturas/`, skills de terceros, `skills-lock.json`, `.claude/launch.json`, `tools/escenarios-locales.mjs`.

## Bloqueos y próximo paso

- **Tuyo:** razón social, CUIT y domicilio (`LEGAL_ENTITY`), correo de contacto, contador (plazos de pedidos y pagos), abogado (los tres textos), WhatsApp definitivo, Supabase Free o Pro.
- **Programar en staging** `purge-video-comments`, `purge-expired-orders` y `prune-cron-history`: el sistema bloqueó la escritura remota; el SQL está en `docs/produccion.md` (4.b, 4.c y 4.e). Mirar `cron.job_run_details` de `purge-expired-reservations` tras el 2026-11-01 06:15 UTC.
- **Antes de producción:** crear proyecto y app, cuenta de Mux de producción, clave de Gemini con facturación, respaldo ensayado, demo estable (se retoma después), prueba en teléfono de lo que sigue en «Para verificar».
- Docker y Supabase local encendidos; `pnpm db:reset` borra los datos de demostración (la migración nueva se aplicó con `migration up`).

Próximo paso: revisar y aprobar el diff; luego commit, revisión de Codex de los precios y, con tu OK, `db push` y despliegue a staging.
