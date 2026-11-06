# Ahora (handoff)

Actualizado: 2026-11-06 · agente saliente: Claude.

## Punto de retomada

En `main`, con commits locales sobre `e0ca2f4` y sin push. La [revisión legal y contable](cambios/revision-legal-contable.md) quedó cerrada en lo que depende del código; falta lo contractual (ver abajo). Decisiones del usuario del 2026-11-06: Supabase de producción en **Free**; cobro con su **cuenta personal** de Mercado Pago (consultarlo con el contador); **Gemini gratis** también en producción (visto bueno de su abogado; ADR 0046 enmendado).

Proyecto de Supabase de producción creado en una organización aparte (`UcoMenu`, Free, São Paulo), referencia `inkeontiwyxlyhohompf`, con Data API y RLS automático activos y sin integración con GitHub. **`supabase/.temp` está vinculado a producción**: cualquier `--linked` apunta ahí; al terminar, revincular staging. `db push --dry-run` mostró que se aplicarían todas las migraciones (base vacía). **El `db push` real aún no se ejecutó: falta la autorización del usuario.**

## Verificación local (2026-11-06)

Unitarias, RLS (1654/1654) y build correctos. Desde Git Bash el test de respaldos falla por el `tar` de GNU; en PowerShell pasa. E2E: se corrigieron dos pruebas desactualizadas (`alta-guiada`, `sala`); `videos-mux`, `panel-push` y `superadmin-cuentas-sin-local` fueron intermitentes. Sigue fallando `portada.spec.ts:92` (el Chromium de esta máquina ahora reproduce el video y la prueba no lo prevé); el código del botón es correcto. Revisar con un navegador real.

## Próximo paso

1. Con autorización: `pnpm exec supabase db push`, y comprobar bucket `product-images` público y las tareas de `pg_cron` (si falla la migración `20261204100000`, activar `pg_cron` en el panel).
2. Primer SuperAdmin a mano ([procedimiento](../docs/produccion.md), paso 2); app de Fly, secretos, dominio y purgas en ese orden.
3. Pendiente del usuario: aceptar los DPA de cada proveedor y archivar la evidencia ([expediente](../docs/transferencias-internacionales.md)); claves de Mux, Resend, Turnstile y Gemini.

Migración `20261219100000` solo local y en producción cuando se haga el push; staging sigue en `20261218100000`. Siguiente libre `20261220100000`. Preservar videos, `.codegraph/`, capturas y skills sin seguimiento.
