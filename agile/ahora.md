# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code
- **Objetivo actual:** «Acceso del personal» (nivel C) implementado y probado en su rama; **falta la revisión independiente de un segundo agente (solo lectura)** antes de integrar a `main`
- **Rama / último commit:** `feat/acceso-del-personal` (commits sobre `main` en `fe95297`, todo commiteado); `main` ya está subido a GitHub; la rama **no** se subió
- **Nivel:** C
- **Ficha relevante:** `agile/cambios/acceso-del-personal.md` · ADR 0007

## Estado
- En `main`: esqueleto caminante, núcleo multi-tenant, planes y entitlements.
- En la rama: login por email y contraseña sin registro público, sesión por cookies `httpOnly` (`@supabase/ssr` 0.12.7), `/panel/{slug}` (Resumen, Suscripción y Personal solo Dueño) y `/sala/{slug}`, selector de local, aviso de mora (gracia, solo lectura, suspendida), gestión de personal por el Dueño (alta, rol, baja, restablecer contraseña), `/cuenta`, invariante «una organización nunca se queda sin owner» en la base, usuarios de ejemplo en el seed y `pnpm dev:crear-dueno`.
- Falta: gestión de carta en el panel, mesas, llamados, SuperAdmin (`platform_admins`, pagos, auditoría).

## Pruebas (2026-10-14, base recién reseteada)
- typecheck · lint · build OK · unitarias 43/43 · RLS 226/226 · E2E 46/46.
- Mutaciones: 22 defensas rotas de a una, 22 detectadas (3 de base, 9 del módulo de personal, 10 de la aplicación).
- No ejecutadas: renovación automática del token por el proxy, Safari/iOS, lector de pantalla, `pnpm dev` con la clave de servicio, configuración de Supabase Cloud, límites de intentos.

## Para usar la app en local
- `SUPABASE_SERVICE_ROLE_KEY` (clave de servicio del Supabase LOCAL) ya está en `.env.local` por autorización del usuario; `.env.local` y `.env.test.local` están ignorados por Git. Sin ella `pnpm dev` no puede gestionar personal. Ver `.env.example`.
- Usuarios del seed (contraseña pública de desarrollo `ucomenu-dev-2026`): `dueno@cafe-ejemplo.test`, `mozo@cafe-ejemplo.test`, `dueno@parrilla-demo.test`, `mozo@parrilla-demo.test`, `dueno@resto-moroso.test`, `mozo@resto-moroso.test`, `multi@ucomenu.test` (Dueño en Café Ejemplo y Personal en Parrilla Demo).
- Tras cambiar `supabase/config.toml` hay que `pnpm db:stop` y `pnpm db:start`.

## Decisiones recientes
- Organización activa en la URL; identidad por `getUser()`; rol por `memberships` en cada pedido; cada página y acción exige su nivel (los layouts no se re-ejecutan).
- `service_role` solo en el módulo de personal, tras comprobar con el cliente de la persona que es Dueño; nunca toma cuentas de otro local.
- Cortar o reducir un acceso (baja, bajar de rol, restablecer) no depende del pago; dar acceso nuevo, sí.
- Estado de mora derivado, bordes inclusivos; en solo lectura y suspendida no se escribe catálogo.

## Bloqueos y riesgos
- Confirmado por el usuario: el Staff ve un aviso de mora operativo reducido y el Dueño el completo (ya en `docs/producto.md`).
- Producción: apagar el registro público y fijar la contraseña mínima de 10 en Supabase Cloud (checklist de «Salida a producción»).
- Contraseña temporal sin cambio forzado; sin recupero por correo; restablecer no revoca sesiones abiertas.
- `org_is_published` se evalúa por fila: medir en «Rendimiento de la carta pública».
- `service_role` puede dejar una suscripción incoherente; la auditoría llega con «SuperAdmin».
- Un `UPDATE`/`DELETE` bloqueado afecta 0 filas sin error; la app debe mostrar el estado con `org_entitlements.can_write`.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`; `pnpm build` antes de `test:e2e`; `pnpm test:rls` y `test:e2e` comparten base: no correrlos a la vez; una corrida de Vitest perdió un worker una vez (`0xC0000409`).

## Próxima acción probable
1. El usuario le pasa la rama a Codex (revisión **solo lectura**, nivel C) y trae el veredicto. Si aprueba, integrar a `main` y subir a GitHub; si pide cambios, corregirlos y repetir una ronda.
2. Con `pnpm dev`, probar el login y el alta de personal de punta a punta.
3. Siguiente ítem: «Gestión de carta» (ya desbloqueado) y luego «Mesas y QR».

## Estado del worktree al cerrar
- Limpio salvo lo ignorado a propósito (`impeccable`, `.env*.local`).
