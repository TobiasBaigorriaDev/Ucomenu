# Ahora (handoff)

Actualizado: 2026-11-06 · agente saliente: Claude.

## Aviso

`supabase/.temp` está vinculado a **staging** (`oasixhsdyigimwvcxtkx`); producción es `inkeontiwyxlyhohompf`. Confirmar `supabase/.temp/project-ref` antes de cualquier `--linked`. El proyecto pausado `ucomenu-restore-20261017` sigue existiendo.

## Punto de retomada

En `main`, igual a `origin/main` (`c17d482`). Producción en marcha desde el 2026-11-06: Supabase Free (84 migraciones, 8 tareas `pg_cron`), Fly `ucomenu-prod` (una máquina; desplegar siempre con `--ha=false`; sesión de Fly en el volumen Docker `ucomenu-fly-config`) y `https://ucomenu.com`. Probados: login, recuperación de contraseña, alta de organización, carta, QR, llamado, video en Mux y cobro con Mercado Pago (pago, reembolso y anulación).

**Registro autoservicio y login con Google abiertos** en producción: el usuario los probó con cuentas reales (correo de confirmación desde `@ucomenu.com`, local con Pro 14 días, ingreso con Google). Cliente OAuth «UcoMenú producción» en el proyecto de Google Cloud `UcoMenu`, con la pantalla de consentimiento publicada y sin logotipo (subirlo exigiría verificar la app). `GOOGLE_LOGIN_ENABLED=1` cargado en Fly. Las cuentas de prueba quedaron en producción: borrarlas desde `/admin` si molestan. Favicon y accesos directos con la marca verde desplegados.

Staging migrado a `20261219100000` con las mismas 8 tareas; su app de Fly (v100) es anterior al código actual.

Demo en producción: «Aurelia» (`/m/aurelia/centro`) y «La Bestia» (`/m/la-bestia/centro`), sin Dueño; sumar al usuario desde SuperAdmin si quiere administrarlas.

Decisiones del usuario: Supabase Free hasta el primer cliente que paga; cobro con su cuenta personal de Mercado Pago; Gemini gratuito; aviso de transferencias retirado de privacidad.

Respaldos: tarea de Windows diaria a las 07:00 (`C:\UcoMenuPrivado\respaldo-programado.ps1`, copias en `C:\UcoMenuCopias`). Contratos con proveedores en `C:\UcoMenuPrivado\contratos`, nada enviado ni aceptado (aplazado hasta tener clientes que pagan). Monitoreo externo con UptimeRobot listo.

## Próximo paso

1. Tras las 06:00 UTC: `cron.job_run_details` en producción y staging debe decir `succeeded`, incluida la purga de cuentas sin confirmar.
2. Del usuario: segunda copia fuera del PC, restauración completa de PostgreSQL, probar el aviso push en un teléfono real.
3. `portada.spec.ts:92` falla en esta máquina (el código es correcto).

Siguiente migración libre `20261220100000`. Preservar videos, `.codegraph/`, capturas y skills sin seguimiento.
