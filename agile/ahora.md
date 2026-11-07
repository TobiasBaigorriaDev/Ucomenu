# Ahora (handoff)

Actualizado: 2026-11-07 · agente saliente: Claude.

## Aviso

`supabase/.temp` está vinculado a **staging** (`oasixhsdyigimwvcxtkx`); producción es `inkeontiwyxlyhohompf`. Confirmar `supabase/.temp/project-ref` antes de cualquier `--linked`. El proyecto pausado `ucomenu-restore-20261017` sigue existiendo.

## Punto de retomada

Producción en marcha desde el 2026-11-06 en `https://ucomenu.com`: Supabase Free (84 migraciones, 8 tareas `pg_cron`) y Fly `ucomenu-prod` (una máquina; desplegar siempre con `--ha=false`; sesión de Fly en el volumen Docker `ucomenu-fly-config`). Registro autoservicio y login con Google abiertos y probados por el usuario; cobro con Mercado Pago, video en Mux, Gemini y VAPID cargados; favicon verde desplegado. Staging está en la migración `20261220100000` con la app actual. Demos «Aurelia» y «La Bestia» en producción, sin Dueño. Las cuentas de prueba del usuario siguen en producción.

**Auditoría de seguridad run-2** (2026-11-07; informes en `C:\Users\tobib\security-audit-skill\UcoMenu\run-2\`): sin críticos ni altos. El hallazgo medio (un Dueño crea cuentas con correos ajenos) está arreglado y **desplegado en staging y producción** (2026-11-07): [ficha](cambios/cuentas-creadas-por-duenos.md), migración `20261220100000`. Commits locales `5717d67` y `427504e`, sin push. Quedan bajos de cobro y pistas por validar de gasto (almacenamiento, Gemini, Mux).

Decisiones del usuario: Supabase Free hasta el primer cliente que paga; cobro con su cuenta personal de Mercado Pago; Gemini gratuito; DPA de proveedores aplazados hasta tener clientes que pagan.

Respaldos: tarea de Windows diaria a las 07:00 (`C:\UcoMenuPrivado\respaldo-programado.ps1`, copias en `C:\UcoMenuCopias`). Monitoreo externo con UptimeRobot listo.

## Próximo paso

1. Probar la variante con Google en staging (cuenta creada por un Dueño, luego ingreso con Google). Regenerar la clave `service_role` de staging, que se mostró en el chat.
2. Tras las 06:00 UTC del 2026-11-07: `cron.job_run_details` en producción y staging debe decir `succeeded`, incluida la purga de cuentas sin confirmar.
3. Del usuario: segunda copia fuera del PC, restauración completa de PostgreSQL, aviso push en un teléfono real.
4. `portada.spec.ts:92` falla en esta máquina (el código es correcto).

Siguiente migración libre `20261221100000`. Preservar videos, `.codegraph/`, capturas y skills sin seguimiento.
