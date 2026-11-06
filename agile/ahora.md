# Ahora (handoff)

Actualizado: 2026-11-06 · agente saliente: Claude.

## Punto de retomada

En `main`, con commits locales sobre `e0ca2f4` y sin push. La [revisión legal y contable](cambios/revision-legal-contable.md) quedó cerrada en lo que depende del código; falta lo contractual (ver abajo). Decisiones del usuario del 2026-11-06: Supabase de producción en **Free**; cobro con su **cuenta personal** de Mercado Pago (consultarlo con el contador); **Gemini gratis** también en producción (visto bueno de su abogado; ADR 0046 enmendado).

Proyecto de Supabase de producción creado en una organización aparte (`UcoMenu`, Free, São Paulo), referencia `inkeontiwyxlyhohompf`, con Data API y RLS automático activos y sin integración con GitHub. **`supabase/.temp` está vinculado a producción**: cualquier `--linked` apunta ahí; al terminar, revincular staging. **El 2026-11-06 el usuario autorizó el `db push` y se aplicaron las 84 migraciones**, sin errores. Comprobado en solo lectura: bucket `product-images` público (2 MB), todas las tablas de `public` con RLS, 0 usuarios y 0 organizaciones, y `pg_cron` con `reset-scheduled-table-turns` y `purge-expired-audit-log` activas. Ese mismo día se programaron las otras seis purgas (4 a 4.f de `docs/produccion.md`): 8 tareas activas; falta revisar `cron.job_run_details` tras su primera ejecución real.

## Verificación local (2026-11-06)

Unitarias, RLS (1654/1654) y build correctos. Desde Git Bash el test de respaldos falla por el `tar` de GNU; en PowerShell pasa. E2E: se corrigieron dos pruebas desactualizadas (`alta-guiada`, `sala`); `videos-mux`, `panel-push` y `superadmin-cuentas-sin-local` fueron intermitentes. Sigue fallando `portada.spec.ts:92` (el Chromium de esta máquina ahora reproduce el video y la prueba no lo prevé); el código del botón es correcto. Revisar con un navegador real.

## Próximo paso

1. Mirar `cron.job_run_details` en producción tras la primera ejecución de las purgas.
2. Primer SuperAdmin registrado el 2026-11-06 (única cuenta de producción; Auth con registro apagado y contraseña mínima de 10). `ucomenu-prod` desplegada en Fly el 2026-11-06 (`https://ucomenu-prod.fly.dev`, dos máquinas en `gru` por defecto de Fly; la sesión de Fly está en el volumen `ucomenu-fly-config`), con `prod:check` en 0 errores; Mux, Gemini, VAPID, Google y Mercado Pago sin cargar (sus webhooks responden 503). Comprobado: cabeceras, robots, sin cookies, `/admin` redirige a login. `/privacidad` sigue mostrando un marcador «Pendiente de definir» (instrumentos de transferencia). Siguen: dominio `ucomenu.com`, Resend, Mux, Mercado Pago, QR.
3. Pendiente del usuario: aceptar los DPA de cada proveedor y archivar la evidencia ([expediente](../docs/transferencias-internacionales.md)); claves de Mux, Resend, Turnstile y Gemini.

Migración `20261219100000` solo local y en producción cuando se haga el push; staging sigue en `20261218100000`. Siguiente libre `20261220100000`. Preservar videos, `.codegraph/`, capturas y skills sin seguimiento.
