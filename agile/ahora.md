# Ahora (handoff)

Actualizado: 2026-11-07 · agente saliente: Claude.

## Aviso

`supabase/.temp` está vinculado a **staging** (`oasixhsdyigimwvcxtkx`); producción es `inkeontiwyxlyhohompf`. Confirmar `supabase/.temp/project-ref` antes de cualquier `--linked`. El proyecto pausado `ucomenu-restore-20261017` sigue existiendo.

## Punto de retomada

Producción en marcha desde el 2026-11-06 en `https://ucomenu.com`: Supabase Free (84 migraciones, 8 tareas `pg_cron`) y Fly `ucomenu-prod` (una máquina; desplegar siempre con `--ha=false`; sesión de Fly en el volumen Docker `ucomenu-fly-config`). Registro autoservicio y login con Google abiertos y probados por el usuario; cobro con Mercado Pago, video en Mux, Gemini y VAPID cargados; favicon verde desplegado. Staging está en la migración `20261219100000` y su app de Fly (v100) es anterior al código actual. Demos «Aurelia» y «La Bestia» en producción, sin Dueño. Las cuentas de prueba del usuario siguen en producción.

**Auditoría de seguridad run-2** (2026-11-07; informes en `C:\Users\tobib\security-audit-skill\UcoMenu\run-2\`): sin críticos ni altos. El hallazgo medio (un Dueño crea cuentas con correos ajenos) está arreglado **en local y sin commit remoto**: [ficha](cambios/cuentas-creadas-por-duenos.md), migración `20261220100000`. Quedan bajos de cobro y pistas por validar de gasto (almacenamiento, Gemini, Mux).

Decisiones del usuario: Supabase Free hasta el primer cliente que paga; cobro con su cuenta personal de Mercado Pago; Gemini gratuito; DPA de proveedores aplazados hasta tener clientes que pagan.

Respaldos: tarea de Windows diaria a las 07:00 (`C:\UcoMenuPrivado\respaldo-programado.ps1`, copias en `C:\UcoMenuCopias`). Monitoreo externo con UptimeRobot listo.

## Próximo paso

1. Con aprobación del usuario: probar el arreglo en staging con dos buzones, aplicar la migración en producción y desplegar.
2. Tras las 06:00 UTC del 2026-11-07: `cron.job_run_details` en producción y staging debe decir `succeeded`, incluida la purga de cuentas sin confirmar.
3. Del usuario: segunda copia fuera del PC, restauración completa de PostgreSQL, aviso push en un teléfono real.
4. `portada.spec.ts:92` falla en esta máquina (el código es correcto).

Siguiente migración libre `20261221100000`. Preservar videos, `.codegraph/`, capturas y skills sin seguimiento.
