# Ahora (handoff)

Actualizado: 2026-10-31 · agente saliente: Claude.

## Punto de retomada

**`main` = `origin/main` en `99794fd` (subido el 2026-10-31).** Desplegado en **staging: Fly v89** (migración `20261216100000` aplicada, la siguiente libre es `20261217100000`). Contiene:

- **Precios en pesos [C]** ([ficha](cambios/precios-en-pesos.md)): catálogo y portada en ARS (Pro anual 278.400; Premium sin precio de lista). Codex lo revisó en 3 rondas (todo atendido) y lo aprobaste vos para staging. Falta ver Suscripción con una sesión real de Dueño y en un teléfono.
- **Cierre de la revisión [M]** ([ficha](cambios/cierre-revision-de-lanzamiento.md)): textos legales (reservas, Gemini, gracia, baja, plazos), cabeceras de seguridad, `robots.txt`, avisos de `prod:check`, `docs/produccion.md` y la recomendación de respaldos en `docs/operacion.md`.

Marcha atrás de la app: imagen `proximas-5d0e3bb-git` (v88), pero **también hay que revertir la migración** (la v88 no lee las columnas nuevas); el rollback está en el encabezado de la migración.

**Sin commit a propósito:** `video/`, `.codegraph/`, `tools/demo-portada/mis-capturas/`, skills de terceros, `skills-lock.json`, `.claude/launch.json`, `tools/escenarios-locales.mjs`.

## Bloqueos y próximo paso

- **Tuyo:** razón social, CUIT y domicilio (`LEGAL_ENTITY`), correo de contacto real (staging usa uno de prueba), contador (plazos de pedidos y pagos), abogado (los tres textos), WhatsApp definitivo, Supabase Free o Pro.
- **Programar en staging** `purge-video-comments`, `purge-expired-orders` y `prune-cron-history`: el sistema bloqueó la escritura remota; el SQL está en `docs/produccion.md` (4.b, 4.c y 4.e). Mirar `cron.job_run_details` de `purge-expired-reservations` desde el 2026-11-01 06:15 UTC.
- **Antes de producción:** proyecto y app, cuenta de Mux de producción, clave de Gemini con facturación, respaldo ensayado, demo estable (se retoma después), pruebas en teléfono de lo que sigue en «Para verificar».

Próximo paso: tu prueba en staging de Suscripción y los textos legales.
