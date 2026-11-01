# Ahora (handoff)

Actualizado: 2026-11-01 · agente saliente: Claude Code.

## Punto de retomada

En `main`. Marca corregida a **UcoMenú** en `98931b9` (subida a `origin/main`; el video local sigue sin seguimiento). El **cobro con link de Mercado Pago** está publicado en staging con revisión independiente aprobada; migración `20261217100000` aplicada en local y staging, siguiente libre `20261218100000` (si cambia el esquema, migración nueva: esta ya salió de la máquina). Alcance, evidencia y limitaciones en [la ficha](cambios/cobro-con-link-de-mercado-pago.md); decisiones en [ADR 0052](../docs/decisiones/0052-cobro-por-link-de-mercado-pago.md).

El 2026-11-01 se creó, con el MCP oficial de Mercado Pago (solo para esta tarea), la aplicación «UcoMenu staging»: App ID `4935369830407609`, Argentina, Checkout Pro, con el webhook de staging guardado (`https://ucomenu-staging.fly.dev/api/mercadopago/webhook`, evento Pagos). La creación automática de credenciales de prueba falló (`MP_API_DOWN`). Los usuarios de prueba (vendedor y comprador) ya existían. No tocar las otras aplicaciones de esa cuenta («Inova E-commers», «TIENDAINOVA»).

## Bloqueos y próximo paso

Staging corre el **release v95** (imagen `cobro-3b9c6d2-git`, 2026-11-01), con los secretos de Mercado Pago cargados. Incluye «Lo que pagás» al final y discreto, y el vencimiento del link con los dos límites (`expiration_date_from` y `_to`, formato `…-03:00`). Verificado: `/`, `/login`, `/privacidad`, `/terminos` 200 y el aviso responde 401 sin firma. Marcha atrás: `--image registry.fly.io/ucomenu-staging:cobro-a79fc30-git` (v94). Sin migración.

1. **Seguir probando un pago:** en el checkout de Mercado Pago el botón «Pagar» quedaba **gris** (comprador de prueba, ventana privada, tarjeta de prueba, saldo cargado). La hipótesis era el vencimiento mal formado; **sin confirmar**: generar un link nuevo y reintentar. Si sigue gris, quitar `expires` del cliente (`src/lib/cobro/mercadopago.ts`; un pago tardío igual se registra) y, si persiste, revisar la cuenta de prueba. No se pudo leer la preferencia desde Mercado Pago (la consulta por SSH fue bloqueada). Los locales de demostración (Aurelia, La Bestia) están pagados hasta 2028 y no ofrecen «Pagar»: probar con un local Pro nuevo desde `/admin/nueva`.
2. Antes de producción: autorización, titular de la cuenta de cobro, pruebas manuales, datos legales, contador y abogado (`docs/produccion.md`).

Entorno: OneDrive provoca bloqueos intermitentes de E2E (usar `--workers=4`) y Docker Desktop dejó de responder durante el despliegue (se usó el constructor remoto de Fly). Falla previa: `owner-lectura` por `account.deleted` en el historial local. Preservar los archivos locales sin seguimiento (`video/`, `.codegraph/`, capturas, skills, `skills-lock.json`, `.claude/launch.json`).
