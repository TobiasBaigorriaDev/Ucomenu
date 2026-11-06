# Ahora (handoff)

Actualizado: 2026-11-06 · agente saliente: Claude.

## ⚠ Cambio temporal en producción

Para el ensayo de Mercado Pago, el precio **mensual de Pro** en producción está en 100 pesos (`plans.monthly_price_cents = 10000`). **Devolverlo al terminar** (29.000 pesos):
`pnpm exec supabase db query --linked "update public.plans set monthly_price_cents = 2900000 where code = 'pro' and monthly_price_cents = 10000 returning code, monthly_price_cents"`
Después comprobar Básico 1490000 y Pro 2900000. `supabase/.temp` está vinculado a **producción**: al terminar, revincular staging.

## Punto de retomada

En `main`, 20 commits locales sin push. Producción en marcha desde el 2026-11-06: Supabase `inkeontiwyxlyhohompf` (Free, 84 migraciones, 8 tareas `pg_cron`), Fly `ucomenu-prod` (una máquina; desplegar siempre con `--ha=false`; sesión en el volumen Docker `ucomenu-fly-config`) y `https://ucomenu.com` con certificado. Probados: login, recuperación de contraseña, alta de organización, carta, QR, llamado, subida de video a Mux. El registro autoservicio sigue apagado en Auth a propósito. Un único SuperAdmin.

Decisiones del usuario: Supabase Free (pasar a Pro con el primer cliente que paga), cobro con su cuenta personal de Mercado Pago (contador de acuerdo, plazo de 2 años de pedidos confirmado), Gemini gratuito, aviso de privacidad sobre transferencias retirado.

Respaldos: tarea de Windows diaria a las 07:00 (`C:\UcoMenuPrivado\respaldo-programado.ps1`, copias en `C:\UcoMenuCopias`, clave en `produccion.env`). Contratos con proveedores preparados en `C:\UcoMenuPrivado\contratos`, nada enviado ni aceptado.

Mercado Pago: aplicación «UcoMenu» (ID 8903312194420057) con webhook de pagos y secretos cargados en Fly. Falta el pago real de ensayo y el reembolso (ver [producción](../docs/produccion.md), 3c).

## Próximo paso

1. Terminar el ensayo de Mercado Pago, reembolsar, anular el pago y **restaurar el precio**.
2. Mirar `cron.job_run_details` tras la primera ejecución de las purgas (06:00 UTC).
3. Del usuario: monitoreo externo, DPA de cada proveedor, segunda copia fuera del PC, restauración completa de PostgreSQL.
4. Funciones apagadas: Gemini, Google login, VAPID, registro autoservicio.
5. Limpieza: revincular staging, migrar staging a `20261219100000`, push a `origin`. `portada.spec.ts:92` falla en esta máquina (el código es correcto).

Siguiente migración libre `20261220100000`. Preservar videos, `.codegraph/`, capturas y skills sin seguimiento.
