# Ahora (handoff)

Actualizado: 2026-11-01 · agente saliente: Codex.

## Punto de retomada

En `main`, corrección de marca confirmada en `98931b9` y subida a `origin/main`, junto con los commits previos del cobro con Mercado Pago. Este cierre documental se confirma por separado; consultar Git para su hash. El usuario autorizó el commit, push a `main` y migración a staging en esta sesión. La publicación de app y migración ya terminó; producción no se tocó.

El nombre correcto es **UcoMenú**. Se corrigieron aplicación, metadatos, manifiesto de instalación, documentación y expectativas de pruebas. Las rutas históricas y nombres técnicos existentes conservan sus referencias reales. También se corrigieron las fuentes editables del video local, que sigue sin seguimiento y quedó fuera del commit y del despliegue para preservar ese trabajo previo.

El **cobro con link de Mercado Pago** está publicado en staging, con revisión independiente aprobada. Alcance, autorización, evidencia de publicación, imagen anterior para recuperación y limitaciones en [la ficha](cambios/cobro-con-link-de-mercado-pago.md); decisiones en [ADR 0052](../docs/decisiones/0052-cobro-por-link-de-mercado-pago.md). La migración `20261217100000` está aplicada en local y staging; siguiente libre `20261218100000`. Si se modifica el esquema, agregar una migración nueva: esta versión ya salió de la máquina.

## Bloqueos y próximo paso

1. El usuario debe crear la aplicación de Mercado Pago y habilitar credenciales de prueba y webhook según `docs/operacion.md`. No se configuraron secretos del proveedor; se conserva el cobro manual.
2. Probar el circuito completo contra Mercado Pago real con un usuario de prueba en staging. Esa integración sigue pendiente.
3. Antes de producción: obtener autorización, resolver titular de la cuenta de cobro, pruebas manuales, datos legales, contador y abogado (`docs/produccion.md`).

Entorno: OneDrive provoca bloqueos intermitentes de E2E; usar `--workers=4`. Sigue registrado el fallo previo de `owner-lectura` por `account.deleted` en el historial local. Preservar los archivos locales sin seguimiento, incluidos videos, capturas, `.codegraph/`, skills, `skills-lock.json` y `.claude/launch.json`.
