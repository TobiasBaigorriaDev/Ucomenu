# AGENTS.md — Agile SDD 1.1.1

Reglas compartidas para Codex CLI y Claude Code. Mantené este archivo **corto**: el detalle vive en `docs/`, `agile/` y las skills.

## Cómo trabajamos
- **Agile SDD** = especificaciones vivas + incrementos pequeños y verificables + autonomía supervisada.
- Sin orden obligatorio: se elige del backlog (`agile/tablero.md`) por valor y riesgo entre los ítems desbloqueados; las dependencias técnicas reales se respetan. Entregas verticales (interfaz + lógica + persistencia + prueba).
- Si el alcance ya está claro, se implementa: `agile-explorar` solo para reducir incertidumbre real.

## Fuentes de verdad (según la pregunta)
- **Qué hace hoy:** código, esquema, tests ejecutados y Git. **Qué debería hacer:** `docs/producto.md`, fichas y ADR aceptados. **Arquitectura:** `docs/arquitectura.md` contrastada con el código.
- **Dónde quedó la sesión:** `agile/ahora.md` (nunca sustituye a Git). **Por qué se decidió algo:** `docs/decisiones/`; Engram es solo una pista.
- Si código y especificación divergen: determinar si es defecto, trabajo pendiente o cambio de requisito, registrarlo, consultar si afecta negocio o datos y corregir lo que corresponda **después** de resolverlo. Los tests también pueden estar desactualizados.

## Una función por documento
| Documento | Función (y nada más) |
| --- | --- |
| Git | Cambios y commits |
| Ficha (`agile/cambios/`) | Aceptación, decisiones particulares y evidencia (resultado + commit o diff probado) |
| `agile/tablero.md` | Prioridad, estado breve y enlace a la ficha |
| `agile/ahora.md` | Punto de retomada, bloqueos y próximo paso: **250–350 palabras**, se reescribe, no se acumula |
| ADR (`docs/decisiones/`) | Motivos de decisiones duraderas |
| `README.md` | Cómo arrancar, sin estado actual |
| `agile/historial.md` | Archivo; no se lee al empezar |

No repitas un dato en dos lugares: enlazá. El tablero y el handoff no copian resultados de pruebas.

## Qué leer al empezar
`AGENTS.md` → `agile/ahora.md` → ficha del cambio, si existe → solo lo pertinente de `docs/`. No cargues el repo ni todos los documentos.

## Nivel de rigor: por consecuencias
**C** si el cambio puede afectar **autorización** (roles, RLS, políticas), **exposición de información** (entre organizaciones, a anónimos, datos personales), **dinero** (planes, vigencias, límites, cobros) o **eliminación irreversible** (borrados, purgas, migraciones destructivas). Modificar datos de forma ordinaria y reversible no es C por sí solo; una purga acotada y recuperable es M. Ante duda sobre estas consecuencias, subí un nivel.

| Nivel | Cuándo | Flujo |
| --- | --- | --- |
| **S** | Local, reversible, objetivo claro | Implementar, comprobación afectada, leer el diff. Sin ficha ni segundo agente por defecto |
| **M** | Varias piezas o comportamiento nuevo, sin consecuencias C | Ficha breve (decisiones + aceptación), implementar, pruebas pertinentes. Revisión independiente solo si hay duda |
| **C** | Alguna consecuencia de arriba | Ficha con invariantes, fallos y recuperación; pruebas de integración pertinentes (RLS/E2E donde apliquen); **una revisión independiente**; aprobación humana antes de lo peligroso |

**Revisión independiente (C):** una ronda normal, en solo lectura, por el otro agente o una sesión limpia. Las rondas siguientes verifican las correcciones y posibles regresiones; se amplía solo ante cambios sustantivos. Sin bucles por estilo.

## Verificación
- **Al iterar:** pruebas por impacto, filtradas por archivo (`pnpm test <ruta>`, `pnpm test:rls <archivo>`, `pnpm exec playwright test <spec>`), más typecheck/lint si tocaste tipos o reglas.
- **Al integrar o entregar:** la comprobación completa que el cambio justifique (build, RLS y E2E si toca esquema, permisos o flujos). Registrala en la ficha con el commit o diff probado.
- **Repetí** ante fallos, cambios posteriores o incertidumbre; un fallo ajeno al cambio (p. ej. un *worker* caído con `0xC0000409`) se repite una vez y se anota. No hay ritual de «dos corridas verdes».
- **Mutaciones** solo para un riesgo concreto (permisos, dinero, aislamiento, concurrencia); si una defensa importa, dejá una prueba de regresión que falle sin ella.
- **Solo documentación o metodología:** sin build, RLS ni E2E.
- Nunca declares «terminado» sin evidencia: qué corriste, qué falló y qué no pudiste correr.

## Comandos del proyecto
Gestor: **pnpm** (Node 24). Antes de las pruebas de base y E2E: Docker encendido, `pnpm db:start`, `pnpm db:reset` y `.env.local` / `.env.test.local` (ver `.env.example`).
- Instalar: `pnpm install --frozen-lockfile`
- Unitarias (sin base): `pnpm test` · RLS (Supabase local; `acl`, `billing` y `limits` usan `docker exec` sobre `supabase_db_ucomenu`): `pnpm test:rls` · E2E (contra el build): `pnpm build` y `pnpm test:e2e` (o `pnpm test:e2e:full`)
- `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm dev`
- Supabase local: `pnpm db:start` · `pnpm db:stop` · `pnpm db:reset` (migraciones + `supabase/seed.sql`) · `pnpm db:types` (regenera `src/lib/supabase/database.types.ts`)
- Migraciones: `pnpm exec supabase migration new <nombre>`; se aplican en local con `pnpm db:reset`. **Nada contra proyectos remotos sin aprobación.**

> Al cambiar el esquema: nueva migración + `supabase/seed.sql` y pruebas dependientes + `pnpm db:types`.
> Windows: clonar en una ruta corta (más de ~260 caracteres rompe `pnpm test` con `ERR_PACKAGE_IMPORT_NOT_DEFINED`).
> `pnpm test:e2e` usa `next start`: corré `pnpm build` antes o se sirve un build desactualizado. RLS y E2E comparten base: no correrlos a la vez.

## Límites de autonomía
**Podés sin pedir permiso:** editar archivos locales del proyecto, ejecutar tests/lint/build, crear ramas y commits locales, actualizar fichas y `agile/ahora.md`.

**Pedí aprobación explícita antes de:**
- instalar dependencias o herramientas nuevas, o ejecutar skills/MCP de terceros;
- desplegar, publicar, gastar recursos de pago;
- migraciones irreversibles, borrado de datos, operaciones sobre producción;
- tocar secretos, credenciales o datos reales de clientes;
- cambiar reglas de negocio críticas (dinero, permisos, stock).

## Calidad, memoria y multi-agente
- Revisá `git status` y los diffs (sin stage, staged, archivos nuevos) antes de cerrar; sin refactors ajenos; preservá los cambios previos. Si lo aprendido invalida la ficha, actualizala y avisá el motivo antes de seguir.
- No guardes secretos, datos de clientes ni transcripciones completas en Git, memoria o prompts. **Engram** (opcional, `memoria/README.md`): selectivo, subordinado a Git y a los requisitos aceptados, nunca reemplaza al handoff.
- El usuario elige manualmente Codex o Claude Code. Única excepción autorizada: Claude Code puede pedirle a Codex CLI una **revisión en solo lectura** con `pnpm revision:codex` (skill `ciclo-revision-codex`); su veredicto no reemplaza la aprobación humana de los cambios C. **Un solo escritor por worktree.** Ramas con `git worktree` y agentes en paralelo solo con independencia real (archivos distintos) y entorno aislado (otra instancia de Supabase con puertos propios). Al cambiar de agente: terminar o pausar, revisar `git status`, actualizar `agile/ahora.md`.

## Skills y cierre
- Skills compartidas: `agile-explorar`, `agile-iterar`, `agile-revisar`, `agile-descubrir-skills`. Fuente en `.agents/skills/`; `python tools/sincronizar_skills.py` las copia a `.claude/skills/`. Impeccable y otros plugins no se sincronizan.
- **Cierre de sesión:** reescribí `agile/ahora.md` (objetivo, rama/commit, bloqueos, próximo paso); la historia queda en Git, la ficha o `agile/historial.md`. Promové decisiones duraderas a `docs/decisiones/`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
