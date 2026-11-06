# Ahora (handoff)

Actualizado: 2026-11-06 · agente saliente: Claude.

## Aviso

`supabase/.temp` está vinculado a **staging** (`oasixhsdyigimwvcxtkx`); producción es `inkeontiwyxlyhohompf`. Confirmar `supabase/.temp/project-ref` antes de cualquier `--linked`. El proyecto pausado `ucomenu-restore-20261017` sigue existiendo.

## Punto de retomada

En `main`, subido a `origin` hasta `416655c` (hay commits locales posteriores solo de documentación). Producción en marcha desde el 2026-11-06: Supabase Free (84 migraciones, 8 tareas `pg_cron`), Fly `ucomenu-prod` (una máquina; desplegar siempre con `--ha=false`; sesión de Fly en el volumen Docker `ucomenu-fly-config`) y `https://ucomenu.com`. Probados: login, recuperación de contraseña, alta de organización, carta, QR, llamado, video en Mux y cobro con Mercado Pago (pago, reembolso detectado por webhook y anulación). Registro autoservicio apagado en Auth a propósito. Un solo SuperAdmin.

Staging migrado a `20261219100000` con las mismas 8 tareas; su app de Fly (v100) es anterior al código actual.

Demo en producción: «Aurelia» (`/m/aurelia/centro`, la que enlaza la portada) y «La Bestia» (`/m/la-bestia/centro`), cargadas con `tools/sembrar-demo-staging.mjs` sin Dueño; sumar al usuario desde SuperAdmin si quiere administrarlas (con `--quitar` se vacían).

Decisiones del usuario: Supabase Free hasta el primer cliente que paga; cobro con su cuenta personal de Mercado Pago (aplicación 8903312194420057; contador de acuerdo); Gemini gratuito; aviso de transferencias retirado de privacidad.

Respaldos: tarea de Windows diaria a las 07:00 (`C:\UcoMenuPrivado\respaldo-programado.ps1`, copias en `C:\UcoMenuCopias`). Contratos con proveedores preparados en `C:\UcoMenuPrivado\contratos`, nada enviado ni aceptado.

## Próximo paso

1. Mañana, tras las 06:00 UTC: `cron.job_run_details` en producción y staging debe decir `succeeded`.
2. Del usuario: monitoreo externo, DPA de cada proveedor, segunda copia fuera del PC, restauración completa de PostgreSQL.
3. Gemini (clave gratuita; el usuario probó que la IA funciona) y VAPID (par propio de producción, subject `mailto:uconext.digital@gmail.com`) cargados en Fly el 2026-11-06; falta probar el aviso con la pestaña cerrada en un teléfono real. Siguen apagadas: Google login y registro autoservicio.
4. `portada.spec.ts:92` falla en esta máquina (el código es correcto).

Siguiente migración libre `20261220100000`. Preservar videos, `.codegraph/`, capturas y skills sin seguimiento.
