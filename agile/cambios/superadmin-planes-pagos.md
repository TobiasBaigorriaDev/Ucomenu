# Cambio: SuperAdmin — cambiar plan, suspender y reactivar, registrar pagos y prueba gratuita como concepto aparte
Estado: verificado en la rama `worktree-agent-ad6dc909d4071a710` (2026-10-17), sin integrar a `main` ni subir; **falta la revisión independiente de Codex** y la confirmación del usuario de las decisiones marcadas «A CONFIRMAR»
Nivel: C (dinero: plan, vigencia y pagos; autorización: nuevas escrituras solo de SuperAdmin; datos: registros que no se borran)

## Objetivo
Que el equipo de UcoMenu (SuperAdmin), desde la ficha de una organización en `/admin/organizaciones/{slug}`, pueda: **cambiar su plan y ciclo**, **suspenderla y reactivarla** a mano, **registrar los pagos** (efecto sobre la vigencia y la mora) y ver la **prueba gratuita de 14 días** como un estado propio, distinto de la mora. Todo auditado de forma que no se pueda reescribir, solo por `service_role`/SuperAdmin, sin ninguna vía de escritura para Dueño ni Staff.

## Decisiones
Las que dependen del producto y no estaban definidas se tomaron por la opción **más conservadora** (no regalar tiempo, no acortar vigencia, no borrar nada) y quedan **A CONFIRMAR POR EL USUARIO**: no están cerradas.

1. **Una función de base por acción**, igual que el alta (ADR 0013): `admin_change_plan`, `admin_set_suspension`, `admin_register_payment`. Solo `service_role`; vuelven a comprobar que `p_actor` es SuperAdmin; toman `FOR UPDATE` de la suscripción; escriben `audit_log` (y `payments`) en la **misma transacción**. La aplicación prueba la identidad con la sesión de la persona antes de usar la clave de servicio; el actor sale de `getUser()`.
2. **Suspensión manual = dato aparte** (`subscriptions.suspended_at`), que `private.org_state` prioriza sobre las fechas. No mueve fechas, no depende de un cron. Suspendida a mano equivale a suspendida por mora (carta oculta, panel en solo lectura, features apagadas).
3. **`payments` solo se agrega** (trigger + privilegios revocados incluso a `service_role`), lo leen solo los SuperAdmin, claves foráneas `RESTRICT` (una organización con pagos no se borra en cascada: el futuro borrado de organizaciones tendrá que definir su retención).
4. **Motivo obligatorio** (1 a 200 caracteres) en el cambio de plan y en la suspensión/reactivación, guardado en `audit_log.after.reason`. En pagos no hay motivo: el pago es su propio registro; la referencia (opcional, 120 caracteres) queda **solo** en `payments`, no en la auditoría.
5. **Prueba gratuita como estado derivado propio** (`private.trial_status`, espejo en `trialStatus`): `none` (sin prueba, o la reemplazó el alta del SuperAdmin) · `in_trial` · `expired` (terminó y nadie asignó ni pagó un período) · `converted` (ya tiene `current_period_end`). La fecha propia es `trial_ends_at`, que **no se borra** al pagar (queda como historia). El Dueño ve estado y fecha en «Suscripción»; el SuperAdmin, en la ficha y en la lista.
6. **Errores**: la base usa mensajes estables (`payment_not_extending`, `already_suspended`…) que la aplicación traduce. Un error **sin SQLSTATE** (red cortada, tiempo agotado) es **resultado incierto** (`uncertain_change`): no se asume éxito ni fallo y se pide mirar el estado antes de repetir. Los reintentos son seguros: repetir un cambio de plan da «sin cambios», repetir una suspensión da «ya suspendida», repetir un pago da «no extiende».
7. **La suspensión se aplica en vivo** (la carta pública decide `suspended` sin caché, ADR del rendimiento de la carta): se oculta en el acto.

### A CONFIRMAR POR EL USUARIO
- **A1. Reactivar no regala tiempo.** Al reactivar, la cuenta vuelve al estado que digan sus fechas (si ya estaba en mora, sigue en mora hasta registrar un pago). La pantalla lo avisa antes.
- **A2. Un pago no levanta una suspensión manual.** Se reactiva aparte. (Conservador: una suspensión por abuso no se deshace por cargar un pago.)
- **A3. Vigencia de un pago: fecha explícita.** El SuperAdmin indica «cubre hasta» (fin de ese día en Argentina). Debe ser **posterior al fin efectivo actual y a ahora**, y a lo sumo 731 días en el futuro. Un pago **adelantado extiende desde el vencimiento actual** (no se pierde lo ya pagado) y **nunca acorta ni repite**. La pantalla propone un ciclo (mes o año) después del mayor entre el vencimiento y hoy; no se valida el importe contra el precio del plan. No hay topes de importe más allá de la sanidad (hasta 10^11 centavos).
- **A4. Cambio de plan sin prorrateo ni cambio de fechas**, rige en el acto. Durante la prueba, pasar a un plan superior da ese plan **sin pago hasta el fin de la prueba** (la pantalla lo avisa). Alternativa más estricta: bloquear el cambio mientras se está en prueba.
- **A5. Prueba vencida = misma degradación de mora, contada desde su fin** (ya era el supuesto de `producto.md`); su estado `expired` es información aparte. No hay «extender la prueba» ni «terminar la prueba» a mano (fuera de alcance).
- **A6. Corrección de un pago mal cargado: no hay pantalla.** Los pagos son inmutables; si se carga uno equivocado (p. ej. una fecha de más), lo corrige el operador por SQL con acceso a la base (apagando el trigger de `payments` y ajustando `subscriptions.current_period_end`), dejando constancia. Es el principal riesgo residual de dinero; se acepta para no abrir una vía de escritura más. Si se prefiere, el siguiente incremento sería «anular pago» como asiento nuevo.
- **A7. Monedas y medios**: lista cerrada (ARS/USD; transferencia, link de pago, efectivo, otro). El pago es de hasta 365 días atrás y no puede ser del futuro.
- **A8. El Dueño no ve sus pagos ni la auditoría todavía** (fuera de alcance); `docs/arquitectura.md` lo preveía.

## Aceptación
- [x] Dado un SuperAdmin, cuando cambia plan y ciclo con motivo, entonces cambian `plan_code`/`billing_cycle`, las fechas no se tocan, y hay **una** fila de auditoría (`subscription.plan_changed`) con actor, antes, después y motivo; los límites y features nuevos rigen en el acto y bajar de plan no borra nada.
- [x] Cuando suspende, la cuenta pasa a `suspended` aunque las fechas estén al día: escrituras bloqueadas (`42501`/0 filas), carta pública «no disponible», datos intactos, el Dueño ve que la suspendió UcoMenu y el Staff solo el estado. Reactivar quita la suspensión **sin mover fechas**. Suspender dos veces o reactivar sin suspensión da error claro y no agrega auditoría.
- [x] Cuando registra un pago válido, se guarda el pago (importe, moneda, medio, referencia, fecha, plan/ciclo del momento, vencimiento anterior y nuevo), la vigencia pasa a «cubre hasta», la cuenta en gracia/solo lectura/mora vuelve a `active` y queda auditoría (sin la referencia).
- [x] Un pago que no extiende (fecha anterior o igual al vencimiento actual, o ya vencida), repetido, con importe/moneda/medio/fechas inválidos o a más de 731 días **no deja ni pago, ni cambio de vigencia, ni auditoría**.
- [x] Dos pagos simultáneos iguales dejan uno; dos distintos terminan en la fecha más lejana sin acortar nunca.
- [x] La prueba: una organización nueva está `in_trial` con su fecha propia; vencida es `expired` y sigue la mora desde su fin; un pago la deja `converted` conservando `trial_ends_at`; el alta con plan y fecha del SuperAdmin es `none`.
- [x] Dueño, Staff, cuenta común, anon y un SuperAdmin **con sesión** no pueden llamar las funciones por la API (`42501`); con `service_role`, un actor que no sea SuperAdmin (Dueño, Staff, común, nulo, desconocido, o uno al que le quitaron el rol) no cambia nada; Dueño y Staff no escriben `subscriptions` ni `payments` y no leen pagos; ni `service_role` ni el dueño de la tabla reescriben `payments`.
- [x] `/admin/organizaciones/{slug}`: 404 para quien no es SuperAdmin (Dueño, Staff) y login sin sesión; sin desborde a 390 px con slug de 64 caracteres, referencia de 120 y motivo de 200.

## Fuera de alcance
Add-ons (WebAR y packs), desactivar o borrar organizaciones, lectura de la auditoría y de los pagos por el Dueño, cobro automático, extender o terminar la prueba a mano, anular o corregir un pago desde la aplicación, sumar una cuenta existente como Dueño, notificaciones al Dueño, `/panel/[org]/sucursales` y la gestión de sucursales (otro agente).

## Invariantes (C)
1. **Plan, suspensión y pagos solo cambian por las tres funciones**, ejecutables únicamente por `service_role`, que recomprueban que el actor está en `platform_admins`. Ningún Dueño, Staff, `anon` ni `authenticated` (aun SuperAdmin) las ejecuta ni escribe `subscriptions`, `payments` ni `audit_log`.
2. **Cada cambio deja su fila de auditoría en la misma transacción**, y `audit_log` y `payments` **no se modifican ni se borran** por ningún camino de la aplicación o la API.
3. **Un pago nunca acorta ni repite la vigencia**: `covers_until > greatest(fin efectivo, now())`, serializado por el lock de la suscripción y respaldado por `unique (subscription_id, covers_until)`.
4. **La suspensión manual manda sobre las fechas**; reactivar no mueve fechas; un pago no levanta la suspensión.
5. **La mora y la prueba se derivan**, nunca se guardan; la prueba conserva su fecha propia.
6. **Bajar de plan no borra datos** (siguen valiendo los triggers de límite, sobre lo nuevo).
7. La referencia de un pago y el email del Dueño no se copian a una tabla que no se puede borrar.

## Fallos y recuperación (C)
| Falla | Resultado |
| --- | --- |
| Cualquier error de la función con SQLSTATE | Rollback de la transacción: ni cambio, ni pago, ni auditoría. Mensaje claro por causa. |
| Se pierde la respuesta (sin SQLSTATE) | `uncertain_change`: no se asume nada; recargar la ficha y mirar estado, pagos y movimientos. Repetir es seguro (cada acción rechaza el duplicado, ver decisión 6). |
| Doble envío / dos SuperAdmin a la vez | El lock de la suscripción los serializa; el segundo recibe el error de «ya está así». |
| Pago equivocado (A6) | Sin pantalla: lo corrige el operador por SQL con constancia. |
| Suspensión equivocada | Reactivar (queda auditado). |
| Cambio de plan equivocado | Cambiarlo de nuevo (queda auditado); las fechas no se habían tocado. |
| Falta `SUPABASE_SERVICE_ROLE_KEY` | «El SuperAdmin no está configurado en este servidor»; no se cambia nada. |
| Falla al cargar la ficha | Aviso en la página, sin romperla. |

## Seguridad y permisos (C)
- Amenaza: un Dueño o Staff llama a las funciones o a la acción → `EXECUTE` solo para `service_role` (ACL probada), `requirePlatformAdmin` (404) en la página y en la acción, función con recomprobación.
- Amenaza: reescribir o borrar el rastro o los pagos → triggers de solo-agregado y privilegios revocados (probado como `postgres`, `service_role` y por la API).
- Amenaza: acortar la vigencia o duplicar un pago con un reenvío → regla del pago + lock + `unique`.
- Amenaza: fuga de la suspensión manual o de las fechas al Staff → `org_entitlements` las entrega solo al Dueño (probado).
- Límite aceptado (igual que ADR 0013): quien tenga la clave `service_role` puede invocar las funciones con cualquier `p_actor` SuperAdmin; la auditoría no protege de eso.

## Migración y rollback
`supabase/migrations/20261017100000_superadmin_planes_pagos_suspension.sql`: aditiva (una columna, una tabla, tres funciones de API, dos privadas, un `check` ampliado) y reemplaza `private.org_state` y `public.org_entitlements` con `create or replace` (conservan permisos). Rollback local: `git revert` + `pnpm db:reset`; con datos, ver la cabecera de la migración (se pierden los pagos). Nada contra proyectos remotos.

## Evidencia
Base aislada propia (`ucomenu-admin`, puertos 55xxx; la instancia por defecto no se tocó), reseteada con todas las migraciones y el seed, sobre el commit de esta rama (2026-10-17):
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK (nueva ruta `/admin/organizaciones/[slug]`) · tipos regenerados idénticos a los versionados (`pnpm db:types` equivalente con `--db-url`, porque `--local` apuntaría a la instancia por defecto).
- `pnpm test` **386/386** (49 nuevas en `src/lib/admin/planes-pagos.test.ts`: importes, motivos, fechas, propuesta de «cubre hasta», prueba y mora, aviso al Dueño, y la traducción de errores de la base con clientes simulados, incluido el resultado incierto).
- `pnpm test:rls` **536/536** en 20 archivos (35 nuevas en `tests/rls/planes-pagos.rls.test.ts`; la matriz de `acl.rls.test.ts` declara las 3 funciones de API, `trial_status`, `payments_append_only` y la tabla `payments`).
- `pnpm exec playwright test` **212/212** (11 nuevas en `e2e/superadmin-planes-pagos.spec.ts`: acceso, plan, suspender/reactivar con la carta pública y el Dueño, pago, datos inválidos, prueba y 390 px). Una corrida anterior perdió un *worker* con `0xC0000409` en `mesas.spec.ts` (ajeno al cambio); repetida, 212/212.
- Sin residuos: 0 organizaciones `tt-*`/`e2e-*`, 0 pagos, 0 filas de auditoría, triggers de solo-agregado activos.
- **Mutaciones (defensas rotas de a una en la base, pruebas de RLS/ACL):** 35 probadas, **34 detectadas y 1 equivalente**. Detectadas: pago sin comprobar al SuperAdmin; sin exigir que extienda; con el borde sobre el fin y no sobre «ahora»; sin mover la vigencia; sin lock de la suscripción (la primera versión de la prueba de concurrencia **no** lo detectaba: se pasó a 8 rondas con fechas distintas y ahora sí); sin validar fecha del pago, importe ni tope de 731 días; fin anterior que ignora la prueba; referencia copiada a la auditoría; acción equivocada en la auditoría; plan sin SuperAdmin, sin motivo, sin «sin cambios», que reinicia la vigencia, sin guardar el «antes»; suspensión sin SuperAdmin, que se repite, que reactiva sin suspensión, que regala 30 días al reactivar, sin lock; `org_state` que ignora la suspensión manual; el Staff recibiendo `suspended_manually`; `trial_status` con borde exclusivo y sin «converted»; `EXECUTE` a `authenticated`, `anon` y `PUBLIC`; lectura de pagos abierta; trigger de UPDATE/DELETE y de TRUNCATE de `payments` quitados (sin el primero la corrida de RLS ni arranca: la limpieza previa lo exige); escritura de `service_role` en `payments`; `authenticated` actualizando `subscriptions`; clave foránea sin `RESTRICT`. **Equivalente:** quitar `unique (subscription_id, covers_until)` (el lock y la regla «extiende» ya impiden el duplicado; queda como defensa en profundidad).
- **Mutaciones de la aplicación:** 3 detectadas (tratar «sin SQLSTATE» como fallo seguro; aceptar fechas de pago futuras; invertir el campo oculto `suspend` del formulario). Quitar de a una las comprobaciones de `requirePlatformAdmin`/`isPlatformAdmin` de la acción, la página o el módulo **no** hace fallar nada por sí solo: son defensa en profundidad y la función de base rechaza al actor (`not_platform_admin`), como ya constaba en ADR 0013.
- **Hallazgos de las pruebas, corregidos:** (1) ids duplicados en la ficha (el `<h2 id="plan">` capturaba el `<label for="plan">`) → prefijo `seccion-`; (2) React 19 reinicia el formulario al terminar la acción y un `<select>` quedaba en «Elegí…», bloqueando en silencio el reenvío tras un error → `key` en los selects; (3) `deleteOrg` y la limpieza de las pruebas ahora también purgan pagos (bloquean el borrado), no la auditoría (hay una prueba que comprueba que sobrevive).
- **No probado / límites:** atomicidad por inyección de fallos (se apoya en que cada función es una sola transacción; la prueba comprueba que ningún rechazo deja filas); lector de pantalla y teléfono real (solo 390 px emulado); contra producción o proyectos remotos (nada); revisión visual con ojos humanos de la ficha; el `await` del doble clic real (el reenvío se probó repitiendo el formulario).

## Solapes con otros trabajos (para quien integre)
- Esta migración reemplaza con `create or replace` **`private.org_state`** y **`public.org_entitlements`**. Si otra rama (sucursales) también las reemplaza a partir de la versión vieja, la última migración en aplicarse **pisa** estos cambios (se perdería la suspensión manual y los datos de prueba del Dueño) sin que falle nada obvio: al integrar, partir de la definición de `20261017100000_*` y volver a correr `tests/rls/planes-pagos.rls.test.ts`.
- También toca `src/lib/entitlements.ts` (tipos y avisos), `src/app/panel/[org]/suscripcion/page.tsx` (filas de prueba y estado), `src/lib/supabase/database.types.ts` (regenerar tras fusionar migraciones) y `tests/rls/{helpers,global-setup,purge-price-history}.ts` y `e2e/support.ts` (limpieza de pagos).
- Nada de `/panel/[org]/sucursales` ni de `enforce_branch_limit`.

## Revisión y aprobación (C)
- **Ronda 1 (Codex, rama contra `main`, commit `89309f7`):** APROBAR CON CAMBIOS. Un hallazgo, real y reproducido: los `<select>` de «Cambiar plan» llevaban una `key` que no cambia tras un éxito, así que el reinicio del formulario devolvía el plan y el ciclo del primer montaje y un envío siguiente podía revertir el plan en silencio. Corrección: la `key` incluye el plan y el ciclo guardados; el E2E «cambia plan y ciclo» ahora comprueba los valores tras guardar (falla sin la corrección). Sin objeciones a permisos, concurrencia, auditoría ni dinero.
- **Ronda 2 (verificación, commit `17c1c2a`):** APROBAR, sin hallazgos nuevos.
- **Aprobación humana de A1–A8: dada por el usuario el 2026-10-16** (tal como están). Integrado a `main`; falta aplicar la migración en staging/producción (con aprobación).
