# Cambio: Simplificación de Agile-SDD
Estado: hecho (aprobado por el usuario 2026-10-15; revisión de solo lectura de Codex: aprobó con un hallazgo, ya corregido)
Nivel: M (solo metodología: sin código de producto, esquema, dependencias ni secretos)

## Objetivo
Menos documentación duplicada, contexto y validaciones repetidas, conservando los controles de permisos, dinero, aislamiento entre organizaciones e integridad de datos. Origen: auditoría de Codex del 2026-10-15 (handoff de ~5.000 palabras, estado repetido en README/tablero/handoff/fichas, S/M/C inconsistente, sincronizador roto por Impeccable).

## Decisiones
- **Rigor por consecuencias:** C si afecta autorización, exposición de información, dinero o eliminación irreversible; modificar datos de forma ordinaria y reversible no es C. Purga acotada y recuperable = M. Antes, cambios de permisos figuraban como M y purgas como S.
- **Flujo S / M / C** en `AGENTS.md`: S sin ficha ni segundo agente; M con ficha breve; C con invariantes, fallos, recuperación, integración y **una** revisión independiente (rondas siguientes solo sobre correcciones y regresiones).
- **Verificación por impacto:** pruebas filtradas durante la iteración, completas al integrar si se justifica, repetición solo ante fallo/cambio/duda. Se retira el ritual de «dos corridas verdes» y las campañas de mutaciones por funcionalidad (quedan para riesgos concretos, preferiblemente como prueba de regresión).
- **Una función por documento** (tabla en `AGENTS.md`). El tablero «Hecho» pasa a una línea por ítem con enlace: las cifras de pruebas ya estaban en cada ficha.
- **Handoff:** `agile/ahora.md` de 250–350 palabras; el contenido anterior se movió **sin pérdida** a `agile/historial.md` (única fuente histórica, lectura no obligatoria), salvo una línea duplicada.
- **Sincronizador:** solo las 4 skills Agile (`SKILLS`); Impeccable y otros plugins no se comparan ni se tocan. Opción `--raiz` para probar sobre copias.
- Sin ADR nuevo: las decisiones viven en `AGENTS.md` y esta ficha. Fichas históricas sin reescribir.

## Aceptación
- [x] `AGENTS.md`, `CLAUDE.md`, las 4 skills, README, prompts y plantilla dicen lo mismo sobre niveles, verificación y revisión.
- [x] `agile/ahora.md` entre 250 y 350 palabras y sin pruebas copiadas.
- [x] README sin estado actual; sin referencias a secciones de `ahora.md` que ya no existen.
- [x] `python tools/sincronizar_skills.py --check` pasa en el repo; sobre copia temporal detecta divergencias en las 4 skills y ignora Impeccable y plugins ajenos.
- [x] Cambios ajenos preexistentes (`.gitignore`, `eslint.config.mjs`, secciones de Codex en tablero y handoff) preservados.

## Fuera de alcance
CI, paralelismo, automatización entre agentes, Engram, configuración global, producto, fichas históricas, bump de versión «1.1.1».

## Evidencia
- Sincronización real: `--check` falló antes de sincronizar (3 skills reescritas distintas) y da OK después; `git status` no muestra cambios en `impeccable`.
- Pruebas aisladas del sincronizador (copia temporal, 6 casos): base OK; Impeccable divergente y plugin extra → OK; Agile divergente/faltante/extra → exit 1 con los tres avisos; sincronizar repara solo Agile y deja Impeccable y plugin intactos (hash igual); fuente sin una skill → exit 2.
- Revisión independiente (Codex, solo lectura): el backlog activo conservaba clasificaciones del criterio viejo. Corregido en `agile/tablero.md`: a C la cuenta existente como Dueño (autorización), la purga de `price_history`, la purga de `waiter_calls` (baja a M si hay respaldo que la haga recuperable) y los borrados de mesas y de categorías/platos (eliminación irreversible; ante duda, un nivel más).
- Revisión del diff completo, coherencia entre Codex y Claude Code y recuento de palabras (ver informe de entrega).
- No ejecutado, por ser solo metodología: build, RLS, E2E, `pnpm db:reset`. No medido: ahorro real de tiempo o tokens (solo reducción de tamaño de documentos).
