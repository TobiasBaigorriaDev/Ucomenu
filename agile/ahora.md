# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code
- **Objetivo actual:** «Acceso del personal» cerrado e integrado a `main` (revisión de Codex: aprobar); siguiente: «Gestión de carta», sin ficha todavía
- **Rama / último commit:** `main` con la integración (fast-forward desde `feat/acceso-del-personal`, hasta `65d801a`) más el commit de documentación de cierre; sin ramas de trabajo abiertas (la rama `feat/acceso-del-personal` queda local y se puede borrar)
- **Nivel:** M (siguiente)
- **Ficha relevante:** `agile/cambios/acceso-del-personal.md` (hecho) · próxima: `agile/cambios/gestion-de-carta.md` (por crear)

## Estado
- En `main`: esqueleto caminante, núcleo multi-tenant, planes y entitlements, y acceso del personal. Los cuatro pasaron revisión de Codex (solo lectura).
- Acceso del personal: login por email y contraseña sin registro público, sesión por cookies `httpOnly` (`@supabase/ssr` 0.12.7), `/panel/{slug}` (Resumen; Suscripción y Personal solo Dueño) y `/sala/{slug}`, selector de local, aviso de mora (completo para el Dueño, operativo reducido para el Staff), gestión de personal por el Dueño (alta, rol, baja, restablecer contraseña), `/cuenta`, guarda «una organización nunca se queda sin owner» en la base, usuarios de ejemplo en el seed y `pnpm dev:crear-dueno`. ADR 0001 a 0007.
- Falta: gestión de carta en el panel, mesas, llamados, SuperAdmin (`platform_admins`, pagos, auditoría).
- GitHub: `main` subido hasta la integración del acceso del personal.

## Pruebas (2026-10-14, base recién reseteada, sobre `65d801a`)
- typecheck · lint · build OK · unitarias 43/43 · RLS 226/226 · E2E 46/46.
- Mutaciones: 22 defensas rotas de a una, 22 detectadas (3 de base, 9 del módulo de personal, 10 de la aplicación).
- Codex reejecutó unitarias (43/43), ACL (11/11), lint y TypeScript; el resto lo respalda la ficha.
- No ejecutadas: renovación automática del token por el proxy, `pnpm dev` de punta a punta, Safari/iOS, lector de pantalla, configuración de Supabase Cloud, límites de intentos de Auth.

## Para usar la app en local
- Usuarios del seed (contraseña pública de desarrollo `ucomenu-dev-2026`): `dueno@cafe-ejemplo.test`, `mozo@cafe-ejemplo.test`, `dueno@parrilla-demo.test`, `mozo@parrilla-demo.test`, `dueno@resto-moroso.test`, `mozo@resto-moroso.test`, `multi@ucomenu.test` (Dueño en Café Ejemplo y Personal en Parrilla Demo).
- `SUPABASE_SERVICE_ROLE_KEY` (clave del Supabase LOCAL) ya está en `.env.local` por autorización del usuario; `.env.local` y `.env.test.local` están ignorados por Git.
- Tras cambiar `supabase/config.toml` hay que `pnpm db:stop` y `pnpm db:start`.

## Decisiones recientes
- Organización activa en la URL; identidad por `getUser()`; rol por `memberships` en cada pedido; cada página y acción exige su nivel (los layouts no se re-ejecutan).
- `service_role` solo en el módulo de personal, tras comprobar con el cliente de la persona que es Dueño; nunca toma cuentas de otro local.
- Cortar o reducir un acceso (baja, bajar de rol, restablecer) no depende del pago; dar acceso nuevo, sí.
- Aviso de mora por rol confirmado por el usuario y asentado en `docs/producto.md`.
- Estado de mora derivado, bordes inclusivos; en solo lectura y suspendida no se escribe catálogo.

## Bloqueos y riesgos
- Producción: apagar el registro público y fijar la contraseña mínima de 10 en Supabase Cloud (checklist de «Salida a producción»).
- Contraseña temporal sin cambio forzado; sin recupero por correo; restablecer no revoca sesiones abiertas.
- `org_is_published` se evalúa por fila: medir en «Rendimiento de la carta pública».
- `service_role` puede dejar una suscripción incoherente; la auditoría llega con «SuperAdmin».
- Un `UPDATE`/`DELETE` bloqueado afecta 0 filas sin error; la app debe mostrar el estado con `org_entitlements.can_write`.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`; `pnpm build` antes de `test:e2e`; `pnpm test:rls` y `test:e2e` comparten base: no correrlos a la vez; una corrida de Vitest perdió un worker una vez (`0xC0000409`).

## Próxima acción probable
1. Probar `pnpm dev` de punta a punta (login con un usuario del seed y alta de personal).
2. Elegir y redactar la ficha de «Gestión de carta» (nivel M; ya desbloqueada) y ejecutar `/agile-iterar`. Los errores `53400` y las escrituras bloqueadas se muestran con `org_entitlements`. Luego «Mesas y QR».

## Estado del worktree al cerrar
- `git status` limpio salvo lo ignorado a propósito (`impeccable`, `.env*.local`).
