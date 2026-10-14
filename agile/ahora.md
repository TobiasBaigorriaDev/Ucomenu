# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code
- **Objetivo actual:** «Núcleo multi-tenant» cerrado e integrado a `main`; siguiente: «Planes y entitlements» (nivel C), aún sin ficha
- **Rama / último commit:** `main` (ver `git log`); sin ramas de trabajo abiertas
- **Nivel:** C (cerrado)
- **Ficha relevante:** `agile/cambios/nucleo-multi-tenant.md` (hecho) · próxima: `agile/cambios/planes-y-entitlements.md` (por crear)

## Estado
- Hecho e integrado a `main`: esqueleto caminante (carta pública con RLS) y núcleo multi-tenant (`memberships`, `private.is_org_member/is_org_owner`, políticas de escritura, permisos por columna; ADR 0004 y 0005). Ambos revisados por Codex.
- Tablas hoy: `organizations`, `branches`, `categories`, `products`, `memberships`. Aún no existen planes, suscripciones, mesas, llamados ni `platform_admins`.

## Pruebas (2026-10-14, sobre el último estado)
- typecheck · lint · build OK · unitarias 23/23 · RLS 81/81 (`catalog`, `tenancy`, `acl`) · E2E 11/11. Mutaciones de RLS y ACL detectadas.
- No ejecutadas: login desde la app (no existe), rendimiento de políticas con volumen, Safari/iOS, lector de pantalla, LCP, modo oscuro.

## Preparación de «Planes y entitlements»
Fuente: `docs/producto.md` (planes, límites, mora, prueba de 14 días, add-on) y `docs/arquitectura.md` (modelo de datos y flags). Alcance probable:
- Tablas `plans` (precios y límites parametrizables, sin valores en el código), `subscriptions`, `subscription_addons`, `payments`, `audit_log`.
- Función de estado de mora derivada de `now()` y `current_period_end`/`trial_ends_at` (`active` → `grace` 1–7 → `read_only` 8–15 → `suspended` 16+).
- `has_feature(organization_id, feature)` que incluye plan, add-ons y mora; límites (sucursales, mesas, platos activos) aplicados en la base al **crear o activar**, sin borrar lo existente. Cierra el riesgo abierto: hoy un miembro puede superar el tope de platos.
- La carta pública debe mostrar «Carta temporalmente no disponible» en `suspended`: toca la política de lectura pública y la ruta `/m/...` (el 404 real ya está resuelto; esto es otro estado).
- Pruebas: matriz plan × feature × mora, límites en el borde (80/81 platos, etc.), aislamiento entre organizaciones y mutación, como en el Núcleo.

**Preguntas para el usuario antes de implementar (cambian reglas de negocio y dinero):**
1. En `read_only` y `suspended`, ¿el Staff/Dueño puede seguir editando la carta y los precios? (el producto dice que el panel sigue accesible; no dice si se puede escribir).
2. ¿Qué plan reciben por defecto las organizaciones sin suscripción cargada (p. ej. las del seed)? Propuesta: prueba de 14 días de Básico al darlas de alta.
3. Al bajar de plan con más platos activos que el nuevo tope, se conservan y solo se bloquea crear más (ya está en producto). Confirmar que **reactivar** un plato inactivo también se bloquea al tope.
4. ¿El SuperAdmin entra en este ítem (`platform_admins` y registro de pagos) o queda para «SuperAdmin»? Propuesta: separado; aquí solo el esquema y las funciones, con datos cargados por `service_role`.

## Decisiones recientes
- Rama principal `main`. Analítica básica desde Pro. Pack extra WebAR +USD 10/mes por 10 platos 3D. `price_history` aprobado.
- `impeccable` y sus agentes: en `.gitignore`.

## Bloqueos y riesgos
- Límites del plan y mora aún no se aplican en las escrituras (se cierra con este ítem).
- Un `UPDATE`/`DELETE` fuera de la organización afecta 0 filas sin error; la app debe tratarlo así.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`. `pnpm build` antes de `test:e2e`. `pnpm test:rls` necesita Docker (consulta el catálogo con `docker exec`).

## Próxima acción probable
1. Responder las preguntas de arriba (o aceptar las propuestas).
2. Crear `agile/cambios/planes-y-entitlements.md` (nivel C) y ejecutar `/agile-iterar`.

## Estado del worktree al cerrar
- `git status` limpio salvo lo ignorado a propósito (`impeccable`).
