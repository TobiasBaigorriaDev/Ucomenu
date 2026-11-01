# Ahora (handoff)

Actualizado: 2026-11-01 · agente saliente: Claude Code.

## Punto de retomada

En `main`. El **cobro con link de Mercado Pago** está en staging con revisión independiente aprobada; migración `20261217100000` aplicada en local y staging, siguiente libre `20261218100000` (si cambia el esquema, migración nueva: esta ya salió de la máquina). Alcance, evidencia y limitaciones en [la ficha](cambios/cobro-con-link-de-mercado-pago.md); decisiones en [ADR 0052](../docs/decisiones/0052-cobro-por-link-de-mercado-pago.md).

Con el MCP oficial de Mercado Pago se creó la aplicación «UcoMenu staging» (App ID `4935369830407609`, Argentina, Checkout Pro) con el webhook de staging guardado. Los usuarios de prueba (vendedor y comprador) ya existían. No tocar las otras aplicaciones de esa cuenta («Inova E-commers», «TIENDAINOVA»).

## Bloqueos y próximo paso

Staging corre el **release v95** (imagen `cobro-3b9c6d2-git`), con los secretos de Mercado Pago cargados. Verificado: `/`, `/login`, `/privacidad` y `/terminos` 200 y el aviso responde 401 sin firma. Marcha atrás: `--image registry.fly.io/ucomenu-staging:cobro-a79fc30-git` (v94). Sin migración.

1. **Primer pago de prueba real registrado (2026-11-01).** Un pago del plan Básico (ARS 14.900) quedó en `payments` (una fila, pago `187247027918`), la vigencia avanzó un mes, la intención quedó pagada y no hay pagos a revisar. Lo registró un aviso firmado de Mercado Pago, o sea que firma, secreto y lectura contra su API funcionan. El botón gris no era nuestro: el usuario probaba con la cuenta de **vendedor** en vez de **comprador**.
2. **Falta probar con Mercado Pago real:** «Ya pagué, verificar», un pago rechazado (titular `OTHE`), un reembolso o contracargo y los reintentos del aviso. Aurelia y La Bestia están pagadas hasta 2028 y no ofrecen «Pagar»: usar el local Pro de prueba o crear otro desde `/admin/nueva`.
3. Antes de producción: autorización, titular de la cuenta de cobro, pruebas manuales, datos legales, contador y abogado (`docs/produccion.md`).

Entorno: OneDrive provoca bloqueos de E2E (usar `--workers=4`) y Docker Desktop no responde (los E2E de «Lo que pagás» quedaron sin ejecutar). Falla previa: `owner-lectura`. Preservar los archivos locales sin seguimiento (`video/`, `.codegraph/`, capturas, skills, `skills-lock.json`, `.claude/launch.json`).
