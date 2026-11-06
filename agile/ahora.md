# Ahora (handoff)

Actualizado: 2026-11-06 · agente saliente: Claude.

## Aviso

`supabase/.temp` está vinculado a **producción**: cualquier `--linked` apunta ahí; al terminar, revincular staging. El precio de Pro que se bajó a 100 pesos para el ensayo de cobro ya se restauró (Básico 1490000, Pro 2900000 / 27840000, verificado el 2026-11-06).

## Punto de retomada

En `main`, 20 commits locales sin push. Producción en marcha desde el 2026-11-06: Supabase `inkeontiwyxlyhohompf` (Free, 84 migraciones, 8 tareas `pg_cron`), Fly `ucomenu-prod` (una máquina; desplegar siempre con `--ha=false`; sesión en el volumen Docker `ucomenu-fly-config`) y `https://ucomenu.com` con certificado. Probados: login, recuperación de contraseña, alta de organización, carta, QR, llamado, subida de video a Mux. El registro autoservicio sigue apagado en Auth a propósito. Un único SuperAdmin.

Decisiones del usuario: Supabase Free (pasar a Pro con el primer cliente que paga), cobro con su cuenta personal de Mercado Pago (contador de acuerdo, plazo de 2 años de pedidos confirmado), Gemini gratuito, aviso de privacidad sobre transferencias retirado.

Respaldos: tarea de Windows diaria a las 07:00 (`C:\UcoMenuPrivado\respaldo-programado.ps1`, copias en `C:\UcoMenuCopias`, clave en `produccion.env`). Contratos con proveedores preparados en `C:\UcoMenuPrivado\contratos`, nada enviado ni aceptado.

Mercado Pago: aplicación «UcoMenu» (ID 8903312194420057) con webhook de pagos y secretos cargados en Fly. Ensayo real completo el 2026-11-06: pago de 100 pesos desde otra cuenta (el vendedor no puede pagarse a sí mismo; comisión 4,21), registrado solo; reembolso detectado solo por el webhook; pago anulado y revisión resuelta. Sin probar en producción: pago rechazado y «Ya pagué, verificar» (sí en staging).

## Próximo paso

1. Mirar `cron.job_run_details` tras la primera ejecución de las purgas (06:00 UTC).
2. Del usuario: monitoreo externo, DPA de cada proveedor, segunda copia fuera del PC, restauración completa de PostgreSQL.
3. Funciones apagadas: Gemini, Google login, VAPID, registro autoservicio.
4. Limpieza: revincular staging, migrar staging a `20261219100000`, push a `origin`. `portada.spec.ts:92` falla en esta máquina (el código es correcto).

Siguiente migración libre `20261220100000`. Preservar videos, `.codegraph/`, capturas y skills sin seguimiento.
