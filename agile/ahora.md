# Ahora (handoff)

Actualizado: 2026-11-01 · agente saliente: Codex.

## Punto de retomada

En `main`, HEAD `a706edd`, con la corrección ortográfica de la marca preparada para commit y publicación autorizados por el usuario. El nombre correcto es **UcoMenú**, según el usuario. Se corrigieron los textos de la aplicación, metadatos, manifiesto de instalación, documentación, expectativas de pruebas y fuentes editables del video. Las rutas históricas, identificadores técnicos en minúsculas y el nombre de la tarea de Windows instalada conservan sus referencias reales. El cambio es S: solo texto; no modifica permisos, reglas de cobro ni estructura de la base. Para deshacerlo, revertir únicamente la sustitución de la marca y esta actualización del handoff; preservar el material local previo sin seguimiento.

El trabajo anterior sigue siendo el **cobro con link de Mercado Pago** (nivel C), implementado y revisado: [ficha](cambios/cobro-con-link-de-mercado-pago.md) y [ADR 0052](../docs/decisiones/0052-cobro-por-link-de-mercado-pago.md). La revisión de Codex está aprobada y el usuario autorizó el commit, push a `main` y migración a staging en esta sesión. Publicación en curso; verificar Git y staging antes de retomarla. Migración `20261217100000` aplicada solo en local; siguiente libre `20261218100000`. Sin secretos configurados: sin `MERCADOPAGO_ACCESS_TOKEN` se mantiene el cobro manual.

## Bloqueos y próximo paso

1. Completar la publicación autorizada de la marca y del cobro en `origin/main`.
2. Aplicar la migración pendiente y actualizar staging juntos; confirmar el historial remoto y la respuesta de la app.
3. El usuario debe crear la aplicación de Mercado Pago y habilitar credenciales de prueba y webhook según `docs/operacion.md`. La integración con el proveedor real sigue pendiente.
4. Antes de producción: resolver titular de la cuenta de cobro, pruebas manuales de staging, datos legales, contador y abogado (`docs/produccion.md`).

Entorno: OneDrive provoca bloqueos intermitentes de E2E; usar `--workers=4`. Sigue registrado el fallo previo de `owner-lectura` por `account.deleted` en el historial local. Preservar los archivos locales sin seguimiento, incluidos videos, capturas, `.codegraph/`, skills, `skills-lock.json` y `.claude/launch.json`.
