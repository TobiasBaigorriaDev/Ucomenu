# AGENTS.md — Agile SDD 1.1.1

Reglas compartidas para Codex CLI y Claude Code. Mantené este archivo **corto**. El detalle vive en `docs/`, `agile/` y las skills.

## Cómo trabajamos
- Metodología: **Agile SDD** = especificaciones vivas + iteraciones pequeñas y verificables + autonomía supervisada.
- Iterativo, no en cascada. El backlog (`agile/tablero.md`) es flexible: **no hay orden obligatorio T001→T002**. Elegí el próximo incremento desbloqueado de mayor valor o que más reduzca riesgo.
- Entregas **verticales** (interfaz + lógica + persistencia + prueba) en vez de capas desconectadas.
- Las dependencias técnicas reales sí se respetan (no implementar sobre un esquema o API inexistente).

## Fuentes de verdad según la pregunta (no hay una jerarquía ciega)
- **Qué está implementado ahora:** inspeccionar código, esquema real, tests ejecutados y estado de Git.
- **Qué debería hacer el producto:** consultar requisitos y criterios de aceptación **vigentes y aceptados** en `docs/producto.md`, `agile/cambios/` y ADR de `docs/decisiones/`.
- **Cómo está organizado técnicamente:** contrastar `docs/arquitectura.md` con la implementación actual; registrar desviaciones.
- **En qué quedó la sesión:** usar `agile/ahora.md` como handoff, nunca como sustituto de Git.
- **Por qué se decidió algo en el pasado:** Engram opcional sirve como pista histórica, no como autoridad.

**Si código y especificación divergen:** no asumir que uno tiene razón por defecto. Determinar si es un defecto, implementación pendiente o cambio de requisitos; registrar la discrepancia, consultar si afecta negocio/datos y corregir el código o actualizar las specs **solo después de resolverlo**. Los tests existentes también pueden estar desactualizados.

## Qué leer al empezar
`AGENTS.md` → `agile/ahora.md` → ficha del cambio relevante → `docs/producto.md` y `docs/arquitectura.md` solo en lo pertinente. **No cargues todo el repo ni todos los documentos en cada tarea.**

## Niveles de rigor (por impacto y riesgo, no por tamaño)
| Nivel | Cuándo | Documentación | Verificación |
| --- | --- | --- | --- |
| **S** | Local, reversible, baja incertidumbre | Sin ficha | Diff + comprobación afectada |
| **M** | Función con varias piezas | Ficha breve con criterios | Tests relevantes + aceptación |
| **C** | Dinero, datos, seguridad, permisos, migraciones destructivas | Ficha ampliada: invariantes, errores, rollback | Integración/E2E, revisión rigurosa, aprobación humana antes de lo peligroso |

## Skills disponibles
- `agile-explorar` — entender, investigar y aclarar antes de construir.
- `agile-iterar` — implementar un incremento verificable.
- `agile-revisar` — revisar diff, pruebas y riesgos con evidencia.
- `agile-descubrir-skills` — evaluar si hace falta una skill externa (solo ante una brecha real).

## Comandos del proyecto
Gestor: **pnpm** (Node 24). Antes de las pruebas de base y E2E: Docker encendido, `pnpm db:start`, `pnpm db:reset` y `.env.local` / `.env.test.local` (ver `.env.example`).
- Instalar dependencias: `pnpm install --frozen-lockfile`
- Tests unitarios (sin base): `pnpm test`
- Tests de RLS (Supabase local; `acl`, `billing` y `limits` usan `docker exec` sobre `supabase_db_ucomenu`; tardan ~25 s): `pnpm test:rls`
- Tests E2E (Playwright, contra el build): `pnpm build` y `pnpm test:e2e` (o `pnpm test:e2e:full`)
- Lint / typecheck: `pnpm lint` · `pnpm typecheck`
- Build: `pnpm build`
- Desarrollo: `pnpm dev`
- Supabase local: `pnpm db:start` · `pnpm db:stop` · `pnpm db:reset` (aplica migraciones + `supabase/seed.sql`) · `pnpm db:types` (regenera `src/lib/supabase/database.types.ts`)
- Migraciones: `pnpm exec supabase migration new <nombre>`; se aplican en local con `pnpm db:reset`. **Nada contra proyectos remotos sin aprobación.**

> Al cambiar el esquema: nueva migración + actualizar `supabase/seed.sql` y las pruebas que dependan de él + `pnpm db:types`.
> Windows: clonar en una ruta corta; con rutas de más de ~260 caracteres `pnpm test` falla con `ERR_PACKAGE_IMPORT_NOT_DEFINED`.
> `pnpm test:e2e` usa `next start`: ejecutá `pnpm build` antes, o un servidor viejo/un build desactualizado sirve CSS inexistente.

## Límites de autonomía
**Podés sin pedir permiso:** editar archivos locales del proyecto, ejecutar tests/lint/build, crear ramas y commits locales, actualizar fichas y `agile/ahora.md`.

**Pedí aprobación explícita antes de:**
- instalar dependencias o herramientas nuevas, o ejecutar skills/MCP de terceros;
- desplegar, publicar, gastar recursos de pago;
- migraciones irreversibles, borrado de datos, operaciones sobre producción;
- tocar secretos, credenciales o datos reales de clientes;
- cambiar reglas de negocio críticas (dinero, permisos, stock).

## Reglas de calidad
- Nunca declares «terminado» sin evidencia: informá **qué pruebas ejecutaste, cuáles fallaron y cuáles no pudiste ejecutar**.
- Revisá `git status`, diferencias sin stage (`git diff`), staged (`git diff --cached`) y cambios de rama cuando aplique; considerá también archivos nuevos sin seguimiento. Sin refactors ajenos al objetivo.
- Si aprendés algo que invalida la ficha, **actualizala y avisá el motivo** antes de seguir con una decisión importante.
- No guardes secretos, datos de clientes ni transcripciones completas en Git, memoria o prompts.

## Multi-agente (sin orquestación)
- El usuario elige manualmente Codex o Claude Code. **No hay llamadas automáticas entre agentes.**
- **Una sola tarea principal a la vez por worktree.** Dos agentes nunca editan el mismo worktree simultáneamente. Para trabajo realmente independiente: ramas + `git worktree`.
- Al cambiar de agente: terminar o pausar, revisar `git status`, actualizar `agile/ahora.md`, abrir el otro agente en el mismo repo.
- Revisión por segundo agente: **solo lectura**, una ronda normal, sin bucles por preferencias de estilo.

## Cierre de sesión
Actualizá `agile/ahora.md` (objetivo, rama/commit, pruebas, bloqueos, próximo paso). Promové decisiones duraderas a `docs/decisiones/`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
