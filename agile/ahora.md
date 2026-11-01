# Ahora (handoff)

Actualizado: 2026-11-01 · agente saliente: Claude Code.

## Punto de retomada

En `main`. Marca corregida a **UcoMenú** en `98931b9` (subida a `origin/main`; el video local sigue sin seguimiento). El **cobro con link de Mercado Pago** está publicado en staging con revisión independiente aprobada; migración `20261217100000` aplicada en local y staging, siguiente libre `20261218100000` (si cambia el esquema, migración nueva: esta ya salió de la máquina). Alcance, evidencia y limitaciones en [la ficha](cambios/cobro-con-link-de-mercado-pago.md); decisiones en [ADR 0052](../docs/decisiones/0052-cobro-por-link-de-mercado-pago.md).

El 2026-11-01 se creó, con el MCP oficial de Mercado Pago (solo para esta tarea), la aplicación «UcoMenu staging»: App ID `4935369830407609`, Argentina, Checkout Pro, con el webhook de staging guardado (`https://ucomenu-staging.fly.dev/api/mercadopago/webhook`, evento Pagos). La creación automática de credenciales de prueba falló (`MP_API_DOWN`). Los usuarios de prueba (vendedor y comprador) ya existían. No tocar las otras aplicaciones de esa cuenta («Inova E-commers», «TIENDAINOVA»).

## Bloqueos y próximo paso

1. El usuario revisa «Credenciales de prueba» de esa aplicación (no las de producción) y carga en su terminal `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_WEBHOOK_SECRET` con `fly secrets set -c fly.staging.toml`; nunca por el chat.
2. **Redesplegar staging con `810ee0a`** (lee `NEXT_PUBLIC_SITE_URL` también del valor incrustado al construir; sin él «Pagar» no aparece). Espera la autorización del usuario.
3. Probar el circuito completo con el comprador de prueba y mirar el historial de avisos (`notifications_history`).
4. Antes de producción: autorización, titular de la cuenta de cobro, pruebas manuales, datos legales, contador y abogado (`docs/produccion.md`).

Entorno: OneDrive provoca bloqueos intermitentes de E2E; usar `--workers=4`. Falla previa: `owner-lectura` por `account.deleted` en el historial local. Preservar los archivos locales sin seguimiento (`video/`, `.codegraph/`, capturas, skills, `skills-lock.json`, `.claude/launch.json`).
