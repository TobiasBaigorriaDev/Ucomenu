# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code
- **Objetivo actual:** «Planes y entitlements» cerrado e integrado a `main`; siguiente: «Acceso del personal» (nivel C), aún sin ficha
- **Rama / último commit:** `main` en `872c656` (+ el commit de documentación de cierre); sin ramas de trabajo abiertas
- **Nivel:** C (siguiente)
- **Ficha relevante:** `agile/cambios/planes-y-entitlements.md` (hecho) · próxima: `agile/cambios/acceso-del-personal.md` (por crear)

## Estado
- En `main`: esqueleto caminante, núcleo multi-tenant y planes y entitlements. Los tres pasaron revisión de Codex (solo lectura).
- Tablas: `organizations`, `branches`, `categories`, `products`, `memberships`, `plans`, `addons`, `subscriptions`, `subscription_addons`. API: `org_entitlements(org)` y `public_menu_status(org, sucursal)`. ADR 0001 a 0006.
- Falta: login y sesión, paneles, alta de personal, mesas, llamados, SuperAdmin (`platform_admins`, pagos, auditoría).
- GitHub: `origin/main` estaba al día hasta `81fb72e`; **los commits de Planes (`42e62c4`, `872c656`) y de documentación no están subidos**. Subir `main` es un paso aparte.

## Pruebas (2026-10-14, sobre `872c656`)
- typecheck · lint · build OK · unitarias 23/23 · RLS 176/176 (`catalog`, `tenancy`, `acl`, `billing`, `limits`) · E2E 16/16.
- Mutaciones: 26 defensas rotas de a una, 24 detectadas, 2 equivalentes (documentadas en la ficha).
- No ejecutadas: rendimiento de `org_is_published` con volumen, Safari/iOS, lector de pantalla, login desde la app (no existe), LCP, modo oscuro.

## Preparación de «Acceso del personal»
Fuentes: `docs/producto.md` (roles y permisos), `docs/arquitectura.md` (Auth, rutas `/panel`, `/sala`, `/admin`), ADR 0005 (membresías) y 0006 (`org_entitlements`).
Alcance probable (nivel C: sesiones y permisos): login y cierre de sesión; sesión por cookies con `@supabase/ssr`; protección de rutas por rol en el servidor (no solo ocultar enlaces); `/panel` (owner y staff, con secciones según rol) y `/sala`; alta/baja de personal por el dueño; regla «una organización no se queda sin owner»; aviso de mora al dueño con `org_entitlements`.

**Ya resuelto:** `@supabase/ssr` está aprobado en el inventario (stack del ADR 0001) y falta instalar con versión fija. Supabase Auth local ya corre; las confirmaciones por email están apagadas en local y la bandeja de pruebas es Inbucket.

**Decisiones del usuario antes de implementar (cambian seguridad y reglas de negocio) — propuesta entre paréntesis:**
1. **Método de login:** email y contraseña, o enlace mágico. (Propuesta: email y contraseña para Dueño y Staff; sin registro público.)
2. **Alta del personal:** el dueño invita por email (requiere un servicio de correo de producción, es un tercero y exige aprobación) o crea la cuenta él mismo con una contraseña temporal que se cambia al entrar (no requiere correo). (Propuesta: contraseña temporal en el MVP; invitación por email cuando se contrate el servicio de correo.)
3. **Alta del dueño inicial:** se crea hoy con el servidor porque el ítem «SuperAdmin» no existe. (Propuesta: un script local solo de desarrollo, y los usuarios de ejemplo en el seed con contraseña pública de desarrollo, nunca en producción.)
4. **Usuario en más de una organización:** el modelo lo permite. (Propuesta: selector simple al entrar si tiene más de una; el panel opera sobre una a la vez.)
5. **Acceso por rol:** `/panel` y `/sala` para owner y staff; el staff no ve plan, personal ni apariencia (ya definido). `/admin` queda fuera hasta «SuperAdmin». (Propuesta: aceptar.)
6. **Recuperar contraseña:** requiere correo. (Propuesta: fuera del MVP de este ítem; el dueño restablece la del personal y el SuperAdmin la del dueño.)

## Decisiones recientes
- Estado de mora derivado, bordes inclusivos; en solo lectura y suspendida no se escribe catálogo.
- Límites por trigger con guarda de pertenencia antes de contar (regla para mesas y modelos 3D).
- `anon` con `USAGE` en `private` y `EXECUTE` solo de `org_is_published`; la prueba de ACL fija la matriz de funciones.
- Rama principal `main`. Analítica desde Pro. Pack extra WebAR +USD 10/mes. `price_history` aprobado. `impeccable` ignorado.

## Bloqueos y riesgos
- Sin decisiones 1 a 6 no se puede fijar el alcance de «Acceso del personal».
- `org_is_published` se evalúa por fila: medir en «Rendimiento de la carta pública».
- `service_role` puede dejar una suscripción incoherente; la auditoría llega con «SuperAdmin».
- Un `UPDATE`/`DELETE` bloqueado afecta 0 filas sin error; la app debe mostrar el estado con `org_entitlements.can_write`.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`; `pnpm build` antes de `test:e2e`; `pnpm test:rls` necesita Docker.

## Próxima acción probable
1. Subir `main` a GitHub (pendiente de tu confirmación).
2. Responder las decisiones 1 a 6 (o aceptar las propuestas).
3. Crear la rama `feat/acceso-del-personal`, redactar `agile/cambios/acceso-del-personal.md` (nivel C) y ejecutar `/agile-iterar`.

## Estado del worktree al cerrar
- `git status` limpio salvo lo ignorado a propósito (`impeccable`).
