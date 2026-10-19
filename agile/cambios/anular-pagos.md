# Cambio: SuperAdmin anula un pago mal cargado
Estado: implementado y verificado en `main` (commit `48dc4f6`), **pendiente la revisión independiente de Codex** y la aprobación final del usuario · plan aprobado por el usuario el 2026-10-19 (anulación como asiento compensatorio; la vigencia se recalcula a partir de los pagos vigentes). La migración **no** se aplicó fuera de la base local.
Nivel: C (dinero: vigencia, mora y pagos; autorización: nueva escritura solo de SuperAdmin; exposición: el Dueño ve el efecto)

## Objetivo
Cerrar el riesgo residual A6 de [superadmin-planes-pagos](superadmin-planes-pagos.md): hoy un pago mal cargado se corrige por SQL, apagando el trigger de `payments`. Que el SuperAdmin pueda **anular** un pago desde `/admin/organizaciones/{slug}` con motivo obligatorio, sin reescribir nada: el pago original queda intacto, la anulación es un registro nuevo, la vigencia vuelve a lo que era y todo queda auditado.

Corregir = anular + registrar el pago correcto con el formulario de siempre (dos pasos; ver «Fallos»).

## Decisiones
1. **Asiento compensatorio, no edición.** Tabla nueva `payment_voids` (solo se agrega, una fila por pago, lectura solo de SuperAdmin). `payments` no se toca: ni columnas nuevas ni triggers distintos. Un pago está **anulado** si tiene fila en `payment_voids`.
2. **Una función por acción** (ADR 0013): `admin_void_payment(p_actor, p_org, p_payment, p_reason)`. Solo `service_role`; recomprueba que el actor es SuperAdmin; toma `FOR UPDATE` de la suscripción; escribe la anulación, el cambio de vigencia y `audit_log` (`payment.voided`) en la misma transacción.
3. **Solo se anula el pago que define la vigencia actual** (el último vigente): `subscriptions.current_period_end = payments.covers_until` del pago. Para corregir uno anterior se anulan de atrás hacia adelante. Así la vigencia que se restaura es exactamente `previous_period_end` del pago y no hay huecos que adivinar.
4. **La vigencia se recalcula a partir de los pagos vigentes.** Al anular, `current_period_end` vuelve a `previous_period_end` del pago; si ese valor es el fin de la prueba (`<= trial_ends_at`), vuelve a `null` y la prueba recupera su estado (`in_trial`/`expired` en vez de `converted`). Control de coherencia: si quedan otros pagos vigentes, el mayor `covers_until` tiene que coincidir con `previous_period_end`; si no (historia tocada a mano), la función **se niega** (`payment_history_inconsistent`) y no adivina.
5. **Puede dejar la cuenta en mora o suspendida por fechas, de inmediato.** Es la consecuencia correcta de quitar tiempo que no se pagó. La pantalla muestra, antes de anular, hasta cuándo queda vigente y en qué estado queda la cuenta. No levanta ni pone una suspensión manual.
6. **Motivo obligatorio** (1 a 200 caracteres), guardado en `payment_voids.reason` y en `audit_log.after.reason`. No se muestra al Dueño.
7. **Se elimina `unique (subscription_id, covers_until)` de `payments`.** Corregir un importe o un medio exige volver a registrar con la **misma** fecha de cobertura, y esa restricción lo impediría. Era defensa en profundidad: la regla «extiende» más el lock ya impiden el duplicado (mutación «equivalente» en la ficha anterior); sigue cubierta por una prueba de pago repetido.
8. **El Dueño ve el efecto.** `owner_payments` suma `voided_at` (la lista marca «Anulado») y `owner_account_history` suma `payment.voided` a su lista blanca (importe, medio, fecha, nuevo vencimiento; sin motivo ni autor). Sin esto el Dueño vería un pago vigente y un vencimiento que bajó.
9. **Errores estables**: `payment_not_found` (P0002), `payment_already_voided`, `payment_not_latest`, `payment_history_inconsistent` (55000), `invalid_reason` (22023), `not_platform_admin` (42501). Un error sin SQLSTATE es resultado incierto (`uncertain_change`), igual que en las otras acciones; repetir es seguro (el segundo intento da «ya anulado»).

## Aceptación
- [x] Dado un SuperAdmin y el último pago vigente de una organización, cuando lo anula con motivo, entonces queda una fila en `payment_voids`, el pago sigue intacto, `current_period_end` vuelve a `previous_period_end` (o `null` si era el fin de la prueba) y hay **una** fila de auditoría `payment.voided` con actor, antes, después y motivo (sin la referencia del pago).
- [x] Anular el único pago de una cuenta en prueba la devuelve a `in_trial`/`expired` conservando `trial_ends_at`.
- [x] Anular el segundo de dos pagos deja la vigencia que dejó el primero; después se puede anular el primero.
- [x] No se anula: un pago ya anulado, un pago que no es el último vigente, un pago de otra organización o inexistente, con motivo vacío o de más de 200 caracteres, ni con un actor que no es SuperAdmin; **ninguno deja anulación, cambio de vigencia ni auditoría**.
- [x] Si la historia es incoherente (el mayor otro pago vigente no coincide con `previous_period_end`), se niega sin cambiar nada.
- [x] Después de anular, se puede registrar de nuevo un pago con la misma fecha de cobertura.
- [x] Dos anulaciones simultáneas del mismo pago dejan una sola.
- [x] Anular no cambia `suspended_at` ni el plan. Si las fechas dejan la cuenta vencida, la carta y el panel pasan a su estado de mora en el acto.
- [x] Dueño, Staff, cuenta común, anon y un SuperAdmin **con sesión** no llaman la función por la API (`42501`); `payment_voids` no se modifica ni se borra por ningún camino (ni `service_role` ni el dueño de la tabla); Dueño y Staff no la leen.
- [x] El Dueño ve el pago marcado «Anulado» y el movimiento «Pago anulado» (sin motivo ni autor); el Staff y otro Dueño no ven nada.
- [x] `/admin/organizaciones/{slug}`: solo el último pago vigente ofrece «Anular»; el aviso dice hasta cuándo queda vigente y en qué estado; los pagos anulados se ven como tales con su motivo; sin desborde a 390 px.

## Fuera de alcance
Editar o borrar un pago; anular pagos que no son el último (se hace de atrás hacia adelante); «corregir» en un solo paso (anular + registrar en una transacción); deshacer una anulación (se registra un pago nuevo); retención de `payments`/`payment_voids` para el borrado de organizaciones (ADR 0012/0013: sigue pendiente).

## Invariantes (C)
1. Los pagos y sus anulaciones **solo se agregan**: `payments` y `payment_voids` no se modifican ni se borran por la API, `service_role` ni el dueño de la tabla (triggers y privilegios).
2. La vigencia solo cambia por `admin_register_payment` o `admin_void_payment`, ambas bajo el lock de la suscripción y con auditoría en la misma transacción.
3. Un pago se anula **a lo sumo una vez** (`unique (payment_id)`) y **solo si define la vigencia actual**.
4. Anular nunca deja una vigencia que no sea la que tenía la cuenta antes de ese pago.
5. La suspensión manual no se toca; el plan y el ciclo no se tocan.
6. El motivo y el autor no llegan al Dueño; la referencia del pago no se copia a la auditoría.

## Fallos y recuperación (C)
| Falla | Resultado |
| --- | --- |
| Error con SQLSTATE | Rollback: sin anulación, sin cambio de vigencia, sin auditoría. Mensaje claro por causa. |
| Se pierde la respuesta (sin SQLSTATE) | `uncertain_change`: recargar y mirar la lista de pagos y los movimientos. Repetir es seguro: da «ya anulado». |
| Doble envío / dos SuperAdmin | El lock serializa; el segundo recibe «ya está anulado» o «no es el último pago». |
| Anulé el pago equivocado | No se deshace: se registra un pago nuevo con los datos correctos (la fecha de cobertura puede repetirse). Queda toda la historia. |
| Anular y volver a cargar son dos pasos | Entre ambos la cuenta puede quedar vencida unos minutos. Se avisa en la pantalla; si no se completa el segundo paso, la cuenta sigue con la vigencia que tenía antes del pago. |
| Falta `SUPABASE_SERVICE_ROLE_KEY` | «El SuperAdmin no está configurado en este servidor»; no se cambia nada. |

## Seguridad y permisos (C)
- Amenaza: un Dueño o Staff anula pagos (o lo intenta por la API) → `EXECUTE` solo para `service_role` (ACL probada), `requirePlatformAdmin` en página y acción, recomprobación en la función.
- Amenaza: reescribir o borrar la anulación → triggers de solo-agregado y privilegios revocados (probado como `postgres`, `service_role` y por la API).
- Amenaza: anular pagos viejos para regalar o quitar tiempo en silencio → solo el último vigente; coherencia de la historia; todo auditado con motivo.
- Amenaza: fuga de motivo/autor al Dueño → proyección por columnas y lista blanca (ADR 0021).
- Límite aceptado (igual que ADR 0013): quien tenga la clave `service_role` puede invocar la función con cualquier `p_actor` SuperAdmin.

## Migración y rollback
`supabase/migrations/20261029100000_anular_pagos.sql`: aditiva (una tabla, una función de API, una privada de solo-agregado, `audit_log.action` ampliado) y reemplaza `owner_payments` y `owner_account_history` (cambia la forma de la primera: se recrea). Quita el `unique` de `payments`. Rollback local: `git revert` + `pnpm db:reset`. Con datos se pierden las anulaciones y la vigencia volvería a ser la de después del pago; ver la cabecera de la migración. Nada contra proyectos remotos sin aprobación.

## Evidencia
Base local (`pnpm db:reset` con todas las migraciones y el seed), sobre el commit `48dc4f6` (2026-10-19):
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK · tipos regenerados (`pnpm db:types`).
- `pnpm test` **654/654** (nuevas: traducción de errores, resultado incierto, `isVoidable` y lectura del Dueño en `planes-pagos.test.ts` y `lectura.test.ts`).
- `pnpm test:rls`: 22 pruebas nuevas en `tests/rls/anular-pagos.rls.test.ts` (quién puede, vigencia restaurada exacta, prueba gratuita, orden último-primero, nueva carga con la misma fecha, mora en el acto, suspensión intacta, rechazos sin huella, coherencia, concurrencia en 6 rondas, solo-agregado y unicidad, lo que ve el Dueño y la ficha). Corrida completa: 748/749; la falla era `owner-lectura` (lista exacta de columnas de `owner_payments`, que ahora suma `voided_at` a propósito) y la de `planes-pagos` que truncaba `payments` sola (ahora la frena la clave foránea de `payment_voids` antes que el trigger: se truncan juntas para seguir probando el trigger). Los cuatro archivos afectados repetidos en verde: 88/88.
- `pnpm exec playwright test --workers=1` completo: **309 pasaron, 1 omitida** (3 pruebas nuevas en `e2e/superadmin-planes-pagos.spec.ts`: flujo completo con el Dueño, solo el último ofrece anular y el motivo es obligatorio, 390 px con motivo de 200 caracteres).
- **Mutaciones** (defensas rotas de a una en la base local, `tests/rls/anular-pagos.rls.test.ts`): 20 probadas, **20 detectadas**. Función: sin comprobar SuperAdmin, sin validar motivo, sin lock, sin «ya anulado», sin «último vigente», sin coherencia de la historia, la prueba que no vuelve a `null`, pago de otra organización, referencia copiada a la auditoría, vigencia sin restaurar, vigencia restaurada a «ahora». Lectura del Dueño: historial que filtra el motivo, sin lista blanca para `payment.voided`, pago sin marca de anulado. Permisos: `EXECUTE` a `authenticated`, política de lectura abierta, sin unicidad por pago, trigger de solo-agregado sin efecto, `service_role` con escritura y con trigger sin efecto, `service_role` con `INSERT`. Dos mutaciones mal armadas al principio (la limpieza de la propia suite re-activaba el trigger; borrar el trigger rompía esa limpieza) se rehicieron neutralizando la función del trigger y ahora se detectan.
- **No probado / límites:** atomicidad por inyección de fallos (cada rechazo prueba que no deja filas; la función es una sola transacción); lector de pantalla y teléfono real (solo 390 px emulado); contra staging o producción (nada: la migración no se aplicó fuera de local); el formulario no comprueba en el servidor la casilla de confirmación (es una guarda de la pantalla; la autoridad es la base).

## Revisión y aprobación (C)
(pendiente)
