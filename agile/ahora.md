# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code
- **Objetivo actual:** «Gestión de carta» cerrada e integrada a `main` (revisión de Codex: aprobar); siguiente: «Mesas y QR»
- **Rama / último commit:** `main` con la integración (fast-forward desde `feat/gestion-de-carta`); la rama queda local y se puede borrar. Ver `git log`
- **Nivel:** M
- **Ficha relevante:** `agile/cambios/gestion-de-carta.md` (hecho) · ADR 0008 · próxima: `agile/cambios/mesas-y-qr.md` (por crear)

## Estado
- En `main`: esqueleto caminante, núcleo multi-tenant, planes y entitlements, acceso del personal y gestión de carta. Los cinco pasaron revisión de Codex (solo lectura).
- Gestión de carta: `/panel/{slug}/carta` (categorías y platos: alta, edición, subir/bajar, activar/desactivar; Dueño y Staff), `/carta/platos/nuevo` y `/carta/platos/{id}` (datos y foto), «Platos activos: X de N» con el mensaje del tope `53400`, formularios deshabilitados con el motivo en solo lectura y suspendida y acciones forzadas sin éxito falso, foto en la carta pública. **Fotos en Supabase Storage** (bucket público `product-images`, ruta por organización, escritura con `org_can_write`; ADR 0008); el navegador reduce la foto antes de subirla. **No hay borrado** de categorías ni platos (se desactivan).
- Falta: mesas y QR, llamados, SuperAdmin (`platform_admins`, pagos, auditoría), variantes y adicionales, historial de precios, borrado de la carta.
- GitHub: `main` subido con la gestión de carta.

## Pruebas (2026-10-14, base recién reseteada, sobre el código final de la rama)
- typecheck · lint · build OK · unitarias 89/89 · RLS 257/257 · E2E 64/64 (tres corridas completas seguidas).
- Mutaciones: 34 defensas rotas de a una, 32 detectadas y 2 equivalentes (explicadas en la ficha).
- Codex (solo lectura): aprobar `c191728`; la observación P3 (borrado de Storage con cero objetos) se corrigió con prueba.
- No ejecutadas: `pnpm dev` de punta a punta, Safari/iOS y cámara del celular, fotos HEIC, lector de pantalla, rendimiento con fotos, bucket en Supabase Cloud, renovación automática del token por el proxy.

## Para usar la app en local
- **Tras actualizar a esta rama: `pnpm db:stop` y `pnpm db:start`** (ahora arranca `storage-api`) y `pnpm db:reset` (migración de fotos).
- Usuarios del seed (contraseña pública de desarrollo `ucomenu-dev-2026`): `dueno@cafe-ejemplo.test`, `mozo@cafe-ejemplo.test`, `dueno@parrilla-demo.test`, `mozo@parrilla-demo.test`, `dueno@resto-moroso.test`, `mozo@resto-moroso.test`, `multi@ucomenu.test` (Dueño en Café Ejemplo y Personal en Parrilla Demo).
- `SUPABASE_SERVICE_ROLE_KEY` (clave del Supabase LOCAL) ya está en `.env.local` por autorización del usuario; `.env.local` y `.env.test.local` están ignorados por Git.
- Tras cambiar `supabase/config.toml` hay que `pnpm db:stop` y `pnpm db:start`.

## Decisiones recientes
- Organización activa en la URL; identidad por `getUser()`; rol por `memberships` en cada pedido; cada página y acción exige su nivel (los layouts no se re-ejecutan).
- `service_role` solo en el módulo de personal; la carta escribe con el cliente de la persona (RLS), nunca con `service_role`.
- Estado de mora derivado, bordes inclusivos; en solo lectura y suspendida no se escribe catálogo (tampoco fotos).
- Carta: desactivar es la baja (sin borrado); precio en centavos enteros, tope $ 10.000.000; fotos JPG/PNG/WebP hasta 2 MB validadas por bytes (ADR 0008).

## Bloqueos y riesgos
- Producción: apagar el registro público y fijar la contraseña mínima de 10 en Supabase Cloud; verificar el bucket `product-images` (checklist de «Salida a producción»).
- El Staff cambia precios sin historial hasta que exista `price_history` (decisión ya aprobada; ítem S desbloqueado).
- Sin cuota de almacenamiento por organización; archivos huérfanos acotados a fallas a mitad de camino; las fotos de una organización suspendida siguen accesibles por URL directa.
- Contraseña temporal sin cambio forzado; sin recupero por correo; restablecer no revoca sesiones abiertas.
- `org_is_published` se evalúa por fila: medir en «Rendimiento de la carta pública» (las fotos hoy se sirven sin optimizar).
- `service_role` puede dejar una suscripción incoherente; la auditoría llega con «SuperAdmin».
- Un `UPDATE`/`DELETE` (y un `remove` de Storage) bloqueado afecta 0 filas sin error: toda escritura nueva debe confirmar las filas afectadas.
- `limits.rls.test.ts` deja un usuario `rls-fuga-otra-org-*` por corrida (preexistente: la guarda del último Dueño frena su borrado); limpiarlo con `delete from auth.users where email like 'rls-%'`.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`; `pnpm build` antes de `test:e2e`; `pnpm test:rls` y `test:e2e` comparten base: no correrlos a la vez; un *worker* de Vitest o de Playwright murió a veces con `0xC0000409` (pasa al repetir).

## Próxima acción probable
1. «Mesas y QR»: redactar la ficha (nivel M) y ejecutar `/agile-iterar` (el usuario lo pidió el 2026-10-14).
2. Probar `pnpm dev` de punta a punta con la cámara del celular (login con un usuario del seed, cargar un plato con foto).
3. Después: historial de precios (S) o variantes y adicionales.

## Estado del worktree al cerrar
- `git status` limpio salvo lo ignorado a propósito (`impeccable`, `.env*.local`).
