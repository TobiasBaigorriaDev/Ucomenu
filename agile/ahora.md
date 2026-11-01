# Ahora (handoff)

Actualizado: 2026-11-01 · agente saliente: Claude Code.

## Punto de retomada

En `main`, solo commits locales (nada en `origin`, nada desplegado). Último commit: `a43f64d`. Antes de esta tarea: `bdf97df`.

Se implementó el **cobro de la suscripción con link de Mercado Pago** (nivel C): el Dueño paga desde Suscripción y el servidor registra el pago solo. Diseño en [ADR 0052](../docs/decisiones/0052-cobro-por-link-de-mercado-pago.md); alcance, evidencia, limitaciones y las cuatro rondas de revisión en [la ficha](cambios/cobro-con-link-de-mercado-pago.md). **Codex aprobó la ronda 4** (rechazó las tres primeras; todos sus hallazgos eran reales y están corregidos). Es una revisión, no la aprobación del usuario.

Migración nueva `20261217100000`, aplicada **solo en la base local** (corregida en su lugar tras la revisión porque nunca salió de esta máquina; si se toca otra vez hay que revertirla primero). Siguiente libre: `20261218100000`. Sin dependencias nuevas. Sin secretos configurados en ningún entorno: sin `MERCADOPAGO_ACCESS_TOKEN` la pantalla sigue con el cobro manual.

## Bloqueos y próximo paso

1. El usuario aprueba subir esto a `origin` y a **staging** (migración y despliegue juntos: la app nueva necesita las funciones).
2. El usuario crea la aplicación de Mercado Pago (hoy tiene una cuenta personal) y pasa las credenciales de **prueba**; configurarlas con `fly secrets set` en staging y el webhook `https://<dominio>/api/mercadopago/webhook` con el evento «Pagos» (`docs/operacion.md`).
3. Probar contra Mercado Pago de verdad con un usuario de prueba: es lo **único sin probar** (formato de vencimiento, `source_news=webhooks`, búsqueda por referencia, reintentos y la unidad del `ts` de la firma).
4. Antes de producción: decidir si cobra una cuenta personal o del negocio.

Entorno: el repositorio está dentro de OneDrive y `OneDrive.Sync.Service` es el mayor consumidor de CPU; con 11 workers los E2E se cuelgan de forma intermitente, también en specs ajenos. Usar `--workers=4`. Falla previa, no de este cambio: `owner-lectura` (fila `account.deleted` en el `audit_log` local).

Siguen pendientes los de antes: pruebas manuales de staging, datos legales, contador, abogado y producción (`docs/produccion.md`). Preservar los archivos ajenos sin seguimiento: `video/`, `.codegraph/`, capturas, skills de terceros, `skills-lock.json` y `.claude/launch.json`.
