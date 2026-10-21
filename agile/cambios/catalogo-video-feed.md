# Cambio: Catálogo del feed de videos — `video_feed` y `videos_published` en `plans`; se retira WebAR
Estado: **implementado, aprobado por el usuario y por Codex (3 rondas, commit `b5ff895`); falta aplicarla en staging.** Migración `20261110100000` aplicada solo en la base local.
Nivel: C (dinero: qué plan obtiene la feature y qué cupo; eliminación irreversible: se borran contratos `webar`)

## Objetivo
Primer incremento de la fase 2 ([ADR 0031](../../docs/decisiones/0031-feed-de-videos-cortos.md), que reemplaza a WebAR): que el catálogo de planes sepa del feed (feature `video_feed` en Premium, cupo `videos_published` = 10 en `plans`) y que desaparezca el add-on `webar` con su límite `models_3d`, sin dejar contratos huérfanos ni una pantalla de SuperAdmin que ofrezca algo inexistente. No construye el feed, la carga ni los likes (ítems siguientes del tablero).

## Decisiones
Los motivos duraderos están en el ADR 0031. Particulares de esta ficha:
1. **Cupo por plan en una columna:** `plans.max_videos_published` (null = sin límite, como los otros topes). Premium 10; Básico y Pro **0** (sin cupo, falla cerrado). `private.org_limit(org, 'videos_published')` la lee; sin suscripción devuelve 0.
2. **Premium recibe `video_feed` en el catálogo ya**, aunque aún no hay feed: no habilita nada visible. Que Premium *se venda* sigue siendo la decisión comercial de `docs/producto.md`.
3. **`video_feed` sobrevive al solo lectura** en `private.has_feature` (junto a `menu` y `analytics`): `docs/producto.md` pide que los videos publicados se sigan viendo. **Invariante para los incrementos siguientes:** subir, publicar, dar like y comentar exigen además `private.org_can_write` (cuenta en gracia o al día); `has_feature` por sí sola no basta para escribir. En suspendida es falso.
4. **WebAR se retira por completo de la base:** los contratos **vigentes** quedan registrados como `addon.ended` (actor «sistema (migración …)», motivo «retirado del catálogo») y después se borran todas las filas `webar` de `subscription_addons` y la de `addons`. Se borran también los vencidos (solo ensayo; la fila `addons` los referencia). El historial viejo se sigue nombrando «WebAR» en las dos pantallas.
5. **Las funciones de add-ons de ADR 0025 se conservan** (el ADR 0031 lo pide) con el catálogo vacío. Para que el próximo add-on no necesite tocar código de validación: `addons.code` pasa de `check (code in ('webar'))` a un chequeo de formato (`^[a-z][a-z0-9_]{0,31}$`) y `isAddonCode` (TypeScript) chequea solo la forma; que el add-on exista lo decide la base (`invalid_addon`). `private.plan_grants` pierde la rama de add-on: hoy solo el plan concede features, y un add-on futuro tendrá que volver a definirla.
6. **Pantalla de SuperAdmin:** con el catálogo vacío dice «Hoy no hay add-ons a la venta. El feed de videos cortos viene incluido en el plan Premium (no se activa acá)». El resto del código de la sección queda para futuros add-ons; el texto del cupo pasó de «platos 3D» a «cupo de N». Los nombres de columnas `base_model_quota` y `pack_size` y el campo `model_quota` de la auditoría son restos de WebAR y se renombran cuando exista un segundo add-on real.
7. **Sin uso de videos todavía:** `org_entitlements` informa `limits.videos_published` y las features, pero no `usage.videos_published` (no existe la tabla de videos); lo agrega el incremento de carga.

## Aceptación
- [x] `plans`: Premium con `video_feed` y `max_videos_published = 10`; Básico y Pro, sin `video_feed` y con cupo 0; el `check` de `features` admite `video_feed` y rechaza lo desconocido (`webar` incluido); un cupo negativo se rechaza.
- [x] `org_entitlements` devuelve `video_feed` solo a Premium al día o en gracia, también en solo lectura, y nada en suspendida; informa `limits.videos_published` (10 / 0) y ya no `models_3d`; el Staff recibe las mismas features.
- [x] El cupo cambia con la fila del plan (sin tocar código) y `null` es sin límite; sin suscripción es 0.
- [x] `webar` no existe en el catálogo ni en `subscription_addons`; `org_limit(…, 'models_3d')` falla como recurso desconocido; aunque alguien vuelva a insertar la fila y un contrato, no concede feature ni cupo.
- [x] Los contratos `webar` vigentes se cierran con una entrada de auditoría y se borran (ensayado con tres contratos: vigente, vencido y con fin futuro → 2 entradas de auditoría, 0 filas; transacción revertida).
- [x] SuperAdmin: la ficha de la organización muestra el estado vacío y ningún formulario; `webar` ya no se puede activar ni finalizar (`invalid_addon`, sin huella); un código con forma inválida ni llega a la base.
- [x] Las funciones de add-ons (activar, cambiar, finalizar, concurrencia, reloj viejo, historial del Dueño) siguen funcionando con un add-on de ensayo `tt_ensayo` que las pruebas insertan y borran.
- [x] Los movimientos viejos de WebAR se siguen nombrando en la auditoría del SuperAdmin y en el historial del Dueño.

## Fuera de alcance
Carga y publicación de videos, Mux, el feed en la carta, likes y comentarios (ítems siguientes de la fase 2); `usage.videos_published`; renombrar las columnas heredadas de WebAR; términos y privacidad; vender Premium.

## Evidencia
Base local con las migraciones hasta `20261110100000` (aplicada con `supabase migration up`, **sin** `db:reset`, para no perder los escenarios locales de la demo), 2026-10-21. Árbol sin commit; mis cambios son esta ficha, la migración, `src/lib/admin/validation.ts`, la sección de add-ons de `src/app/admin/organizaciones/[slug]/` (`page.tsx`, `forms.tsx`), los comentarios de `audit.tsx` y `lectura.ts`, `database.types.ts` (regenerado), `docs/` y las pruebas.
- `pnpm lint` y `pnpm typecheck` limpios · `pnpm test` **805/805**.
- RLS: `billing` + `addons-y-baja` **110/110** (billing 71, con 14 casos nuevos entre features por plan y estado, catálogo, cupo, retiro de WebAR y formato del código). Corrida completa: 933/948; **fallan 15, las mismas que el handoff atribuye a los escenarios locales cargados** (`catalog`, `tenancy`, `opciones`, `tables`, `push`: comparan contra el seed puro o toman «la primera organización»), ninguna de planes ni add-ons.
- E2E (servidor `next dev` aparte en el puerto 3200 con `E2E_BASE_URL`, para no pisar el `.next` de los servidores 3000 y 3001 del usuario): `superadmin-addons-baja` 7/7 (una nueva: catálogo vacío), `superadmin-planes-pagos`, `superadmin` y `cuenta-pagos-historial`, 36/36.
- **Ensayo de la migración sobre datos:** dentro de una transacción revertida, con tres contratos `webar` sembrados (sin fin, vencido, con fin futuro) → 2 entradas `addon.ended` del sistema, 0 contratos, catálogo vacío, planes con los valores esperados.
- Tras la ronda 1: `retiro-webar` 2/2 (ver «Revisión»).
- **Mutaciones** (defensas rotas de a una con `create or replace`, restauradas desde la migración; control 71/71): 8 probadas (con el `lock` del retiro y su modo), **8 detectadas** — `has_feature` sin `video_feed` en solo lectura, `has_feature` sin la suspensión, `has_feature` sin ningún filtro de mora, `plan_grants` que concede `video_feed` a todos, `org_limit` de videos sin límite y sin suscripción con límite.
- **No probado / límites:** `pnpm build` (reemplazaría el `.next` de los servidores del usuario; typecheck y lint sí, y las pantallas corrieron en `next dev`); la migración sobre una base con contratos reales (solo el ensayo en transacción: no hay datos en local; staging no se consultó); producción y staging no se tocaron.

## (C) Invariantes
1. Solo el plan concede `video_feed`; ningún add-on, contrato ni fila del catálogo la concede (probado reinsertando `webar`).
2. Básico y Pro no tienen cupo de videos (`0`); sin suscripción tampoco; cambiar el cupo es cambiar una fila de `plans`, que solo escribe el servidor.
3. La mora apaga `video_feed` en suspendida y deja solo la visibilidad en solo lectura; la escritura sobre videos exigirá `org_can_write` (incrementos siguientes).
4. Ningún permiso nuevo: `create or replace` conserva los `EXECUTE`; no se abre nada a `anon` ni a `authenticated` (la prueba `acl` sigue verde en la corrida completa).
5. El retiro de WebAR deja rastro: cada contrato vigente tiene su `addon.ended` en `audit_log` (solo se agrega), también si otra sesión lo reactiva mientras la migración espera (bloqueo de tabla `exclusive`).

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| La migración falla a mitad | Es una transacción: no queda nada a medias. |
| Un contrato `webar` real aparece en una base antes de migrar | Queda su `addon.ended` con los packs y el fin en `before`; reconstruirlo exigiría volver a crear la fila `webar` (rollback en la cabecera de la migración) y llamar a `admin_set_addon`. No existe en local ni se vendió. |
| Se baja un Premium con videos publicados (incrementos siguientes) | No se borra nada; el feed deja de mostrarse (regla de `docs/producto.md`). |
| Alguien reinserta el add-on `webar` | No concede nada; la prueba lo fija. |

## Migración y rollback
`supabase/migrations/20261110100000_catalogo_video_feed.sql`: columna y `check` nuevos en `plans`, retiro de WebAR (**borra** filas de `subscription_addons` y `addons`, tras auditarlas), `check` de formato en `addons.code` y cuatro funciones reemplazadas (`plan_grants`, `has_feature`, `org_limit`, `org_entitlements`). Rollback documentado en su cabecera. **No aplicada en staging ni en producción**; hace falta aprobación para `supabase db push` (AGENTS.md).

## (C) Revisión y aprobación
- **Aprobación del usuario (2026-10-21):** «Apruebo todo», sobre el resumen con lo pendiente (commit, revisión y migración en staging). Commit `88603fa`.
- **Ronda 1 (Codex, `88603fa`):** APROBAR CON CAMBIOS, un hallazgo Importante, **real**: la migración auditaba los contratos vigentes y después los borraba sin bloquear la tabla; si `admin_set_addon` reactivaba un contrato vencido entre los dos pasos, se borraba sin su `addon.ended`. **Corregido:** `lock table public.subscription_addons in share row exclusive mode` al inicio del bloque de retiro. Regresión determinista en `tests/rls/retiro-webar.rls.test.ts`: reejecuta el bloque de la migración (entre las marcas `[retiro-webar:…]`) mientras otra sesión, dentro de `pg_sleep`, tiene el contrato reactivado sin confirmar; **falla sin el `lock`** (comprobado quitándolo) y pasa con él. La misma prueba fija que se audita solo lo vigente y se borra todo.
- **Ronda 2 (verificación, `ae67c75`):** APROBAR CON CAMBIOS, un hallazgo Importante, **real**: `SHARE ROW EXCLUSIVE` deja pasar el `select … for update` de `admin_set_addon` / `admin_end_addon` pero bloquea su `update`, y el `delete` del retiro espera esa fila → interbloqueo (PostgreSQL aborta una de las dos). **Corregido:** el bloqueo pasa a `EXCLUSIVE`, que frena también el `for update`. Prueba nueva (sesión que toma la fila, tarda y escribe después): **falla con `share row exclusive` y sin bloqueo**, pasa con `exclusive` (`retiro-webar` 3/3).
- **Ronda 3 (verificación, `b5ff895`):** **APROBAR**, sin hallazgos nuevos; los dos previos, corregidos. Revisión estática (Codex no ejecutó suites).
- **Staging: no aplicada.** `supabase db push --dry-run` (2026-10-21) listó cuatro migraciones: la mía y `20261108100000`, `20261108110000` y `20261109100000` (paletas, estilo y temas de fecha: sin commit y sin aprobación del usuario). `db push` no admite elegir una, así que se frenó a la espera de decisión del usuario.
