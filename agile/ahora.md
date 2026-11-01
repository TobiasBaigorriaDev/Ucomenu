# Ahora (handoff)

Actualizado: 2026-11-01 · agente saliente: Claude Code.

## Punto de retomada

En `main`. Marca corregida a **UcoMenú** en `98931b9` (subida a `origin/main`; el video local sigue sin seguimiento). El **cobro con link de Mercado Pago** está publicado en staging con revisión independiente aprobada; migración `20261217100000` aplicada en local y staging, siguiente libre `20261218100000` (si cambia el esquema, migración nueva: esta ya salió de la máquina). Alcance, evidencia y limitaciones en [la ficha](cambios/cobro-con-link-de-mercado-pago.md); decisiones en [ADR 0052](../docs/decisiones/0052-cobro-por-link-de-mercado-pago.md).

El 2026-11-01 se creó, con el MCP oficial de Mercado Pago (solo para esta tarea), la aplicación «UcoMenu staging»: App ID `4935369830407609`, Argentina, Checkout Pro, con el webhook de staging guardado (`https://ucomenu-staging.fly.dev/api/mercadopago/webhook`, evento Pagos). La creación automática de credenciales de prueba falló (`MP_API_DOWN`). Los usuarios de prueba (vendedor y comprador) ya existían. No tocar las otras aplicaciones de esa cuenta («Inova E-commers», «TIENDAINOVA»).

## Bloqueos y próximo paso

Staging corre el **release v94** (imagen `cobro-a79fc30-git`, 2026-11-01): incluye `810ee0a` (el botón «Pagar» ya aparece), con los secretos `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_WEBHOOK_SECRET` cargados por el usuario. Verificado desde afuera: `/`, `/login`, `/privacidad` y `/terminos` 200 y el aviso de Mercado Pago responde 401 sin firma. Marcha atrás de la app: `--image registry.fly.io/ucomenu-staging:marca-98931b9-git` (v92). Sin migración nueva.

1. **Probar un pago de verdad:** como Dueño de un local Pro, al día y no suspendido, Suscripción → Pagar, y pagar con el comprador de prueba y una tarjeta de prueba de Argentina (titular `APRO`). Si algo falla, leer el historial de avisos con el MCP (`notifications_history`) y los registros de Fly. Es lo único sin probar contra Mercado Pago real.
2. Antes de producción: autorización, titular de la cuenta de cobro, pruebas manuales, datos legales, contador y abogado (`docs/produccion.md`).

Entorno: OneDrive provoca bloqueos intermitentes de E2E (usar `--workers=4`) y Docker Desktop dejó de responder durante el despliegue (se usó el constructor remoto de Fly). Falla previa: `owner-lectura` por `account.deleted` en el historial local. Preservar los archivos locales sin seguimiento (`video/`, `.codegraph/`, capturas, skills, `skills-lock.json`, `.claude/launch.json`).
