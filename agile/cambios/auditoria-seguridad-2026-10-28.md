# Auditoría de seguridad — 2026-10-28

Estado: revisión local y corrección de expectativa ACL; sin cambios funcionales.

## Alcance y decisiones

Auditoría con `.agents/skills/security-audit/SKILL.md`, reconocimiento, revisión por límites de confianza, validación independiente y evidencia local. El usuario autorizó las pruebas habituales como excepción al sandbox exigido por la skill.

Se reprodujo el riesgo residual de vencimiento de reservas de cuentas globales del [ADR 0032](../../docs/decisiones/0032-reserva-de-cuentas-globales.md). Tras explicar la alternativa de reserva duradera y recuperación controlada, el usuario eligió **«Conservar el riesgo aceptado»**. No se cambian reservas, permisos ni reglas de negocio.

La prueba ACL omitía `branches.tip_percent`, permiso ya aprobado por la [ficha de propina](propina-sugerida.md) y su migración. Se actualizó únicamente la expectativa de `tests/rls/acl.rls.test.ts`; no se amplían privilegios.

## Evidencia y límites

Informe, registro de cobertura, hallazgo, comandos y resultados: [REPORT.md](C:/Users/tobib/security-audit-skill/UcoMenu/run-1/REPORT.md). Artefactos fuera del repositorio por requisito de la skill. El informe identifica la revisión Git y el diff probado; los archivos de reproducción usan exclusivamente cuentas ficticias locales.

La revisión de fuente no certifica configuraciones remotas ni sustituye las suites completas RLS/E2E. No hubo despliegue, migración remota, cambios de secretos ni consumo de servicios de pago. El único cambio ejecutable del repositorio es la expectativa del test; revertir esa línea revierte la corrección. Sin commit ni push de esta sesión.
