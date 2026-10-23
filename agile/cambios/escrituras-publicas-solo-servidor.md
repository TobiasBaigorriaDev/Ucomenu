# Cambio: Escrituras públicas de la mesa solo desde el servidor
Estado: **hecho y en staging (2026-10-23)**: aprobado por Codex en una ronda sin hallazgos bloqueantes y por el usuario, que pidió subirlo y desplegarlo.
Nivel: **C** — cambia quién puede ejecutar las tres funciones que escriben en la base desde la mesa (autorización) y pone la clave de servicio en la ruta de una acción pública. Decisión: [ADR 0038](../../docs/decisiones/0038-escrituras-publicas-solo-servidor.md).

## Objetivo
Cerrar el límite conocido de [comentarios](comentarios-del-feed.md), [likes](likes-del-feed.md) y [llamado](llamado-desde-la-mesa.md): quien llamaba la función directo con la clave pública y un token de mesa omitía el ticket de visita y la clave de conexión.

## Decisiones (particulares)
1. Migración `20261116100000`: `create_waiter_call`, `set_video_like` y `submit_video_comment` pasan a `service_role` únicamente. Solo permisos; ninguna función cambia.
2. `src/app/t/[token]/actions.ts` y `src/app/t/[token]/videos/actions.ts` llaman con `createAdminClient()` (ya `server-only`). La lectura de comentarios aprobados sigue con el cliente público.
3. Sin `SUPABASE_SERVICE_ROLE_KEY`, `createAdminClient()` lanza. Se evalúa dentro de la acción (no al renderizar la página), así que la carta se sigue viendo; la acción falla y el comensal no recibe el mensaje traducido de «no disponible» sino un error de la acción. Staging ya tiene el secreto (lo usa el push).
4. `record_dish_view` queda fuera (no escribe contenido; ver ADR).

## Invariantes
- `anon` y `authenticated` (Dueño, Staff, ajeno) reciben `42501` al llamar a las tres funciones y no se crea ninguna fila.
- Las reglas de adentro y los mensajes que ve el comensal no cambian.
- Fallo: clave de servicio ausente → la acción lanza (el comensal ve el error genérico de la acción y no se escribe nada); inválida → la base rechaza, `placeCall`/`setVideoLike`/`submitVideoComment` lo traducen a «no disponible» y lo registran sin token ni IP. Recuperación: configurar el secreto (`fly secrets set`). Es una configuración que el despliegue ya exige (push, personal, SuperAdmin).

## Aceptación
- [x] `anon`, Dueño y Staff no ejecutan `create_waiter_call` (prueba nueva en `waiter-calls.rls`), `set_video_like` (`video-likes.rls`) ni `submit_video_comment` (`video-comments.rls`); `acl.rls` registra las tres como `[false, false]`.
- [x] El resto de las pruebas que llamaban a las funciones con `anon` ahora lo hacen con `service_role` y mantienen su cobertura.
- [x] E2E de llamado, sala, aviso y analítica en verde contra el build.
- [x] Revisión independiente (C): Codex APROBAR (informe `output/revisiones/2026-10-23T06-23-24-commit-HEAD.md`); su única sugerencia (el ADR prometía «no disponible» sin la clave) quedó corregida.
- [x] Despliegue en staging (migración + Fly con `SUPABASE_SERVICE_ROLE_KEY`, que ya lo usa el push).

## Evidencia
Sobre el diff sin commitear de la rama `main` (2026-10-23):
- `pnpm typecheck` y `pnpm lint` limpios · `pnpm db:reset` con la migración nueva · `pnpm test:rls` completo **49 archivos, 1114/1114**.
- `pnpm test`: 902/903; la única falla es `textos.test.ts` («Menufeed» igual en es y en, del commit `07facba`, ajena a este cambio). Las pruebas de las acciones (`like-action`, `comment-action`) ahora simulan el cliente de servicio.
- `pnpm build` y E2E contra el build: `llamados`, `ticket-de-visita`, `likes-feed`, `comentarios-feed`, `panel-llamados-aviso`, `analitica`, `llamado-config`, `sala-push` 92/92 en la repetición (la primera corrida tuvo fallas intermitentes que no se repitieron); `sala` y `feed-videos` 40/41 y `sala.spec:323` (la intermitente conocida) pasa sola.
- Pruebas nuevas: una por función, con `anon`, Dueño y (en llamado) Staff recibiendo `42501` y cero filas; `acl.rls` pasa las tres a `[false, false]`.
- Mutación no corrida: devolver el `grant … to anon` hace fallar de inmediato las tres pruebas nuevas y `acl.rls`.
- En staging (2026-10-23): `git push` a `origin/main` (`98a0c23`), las tres migraciones (`20261116100000`, `20261117100000`, `20261118100000`) con `db push` y Fly `ucomenu-staging` versión 32 (comprobación de salud en verde). Con la clave pública, un anónimo recibe 401/`42501` al llamar a `create_waiter_call`, `set_video_like`, `submit_video_comment`, `admin_list_orphan_accounts` y `my_guide_dismissed`; `/` responde 200 y `/admin/cuentas` sin sesión redirige a `/login`. No se probó con un teléfono ni se envió ningún comentario real.
