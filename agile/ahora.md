# Ahora (handoff)

Actualizado: 2026-11-04 · agente saliente: Codex.

## Punto de retomada

En `main`, con commits locales sobre `e0ca2f4`, sin push ni despliegue. La [revisión legal y contable](cambios/revision-legal-contable.md) continúa con [auditoría, cifrado y transferencias](cambios/retencion-cifrado-transferencias.md), nivel C. El usuario pidió recomendar y aplicar las soluciones y confirmó aprobación previa de abogado y contador. Responsable y contacto están completos; la fecha pública y la aceptación del alta comparten `LEGAL_VERSION`. La ficha C contiene decisiones, resultados y límites, sin copiarlos aquí.

Auditoría: mínimo 10 años y mientras exista el local o queden pagos/anulaciones asociados; preserva la baja y la identidad contable de locales borrados. Copias: `pnpm respaldo` exige clave y produce `.tar.gz.aes`; apertura con `pnpm respaldo:abrir`. Uso y límites en [la guía](../docs/respaldo-cifrado.md). Los temporales en claro requieren volumen cifrado. No se creó una clave permanente ni se programó una copia real. Ensayo repetible: `tests/integration/respaldo-cifrado.mjs`.

Migración `20261219100000` aplicada solo localmente; staging continúa en `20261218100000`. Siguiente libre `20261220100000`. Registro autoservicio en staging según [su ficha](cambios/registro-autoservicio.md). Imagen de recuperación: `registry.fly.io/ucomenu-staging:registro-cd80cb4-git` (v100); `cobro-3b9c6d2-git` (v95) retira el registro. Skill legal de usuario: `C:/Users/tobib/.codex/skills/revision-legal-contable-ar/SKILL.md`.

## Bloqueos y próximo paso

Claude pidió cambios en la primera ronda; se corrigieron los hallazgos y se verificaron. Segunda ronda pendiente: suspender ediciones durante la revisión. Las transferencias tienen mecanismo y anexos preparados, pero falta acreditar aceptación de contrapartes conforme al [expediente](../docs/transferencias-internacionales.md). Antes de producción: formalizar instrumentos, configurar clave/volumen, programar copias y ensayar restauración integral. Seguir [producción](../docs/produccion.md) para cuentas y despliegue.

Mercado Pago: rechazo todavía sin evidencia. Siguen recomendados DMARC y dominio propio de Auth. Tras actualizar Auth, comprobar acceso de cuentas creadas por servidor.

Docker se reinició para verificar localmente. OneDrive afecta E2E. Preservar videos, `.codegraph/`, capturas, skills y configuraciones preexistentes sin seguimiento.
