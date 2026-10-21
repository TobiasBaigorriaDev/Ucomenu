# Cambio: SuperAdmin borra definitivamente una organización
Estado: **implementado y probado en local; pendiente de revisión independiente (Codex) y de la aprobación humana** (2026-10-20). Sin integrar a `main`, sin migración en staging ni producción.
Nivel: C (eliminación irreversible de datos de un cliente; autorización: acción solo de SuperAdmin; exposición: la organización y su personal dejan de existir; dinero: los pagos se conservan)

## Objetivo
Cerrar el ciclo de vida de una organización: tras la baja reversible (ADR 0025), el SuperAdmin puede **borrarla definitivamente**. Las dos retenciones que lo bloqueaban ya están decididas (ADR 0026, `price_history` se purga con la organización; ADR 0027, los pagos sobreviven 10 años). Motivos duraderos: [ADR 0028](../../docs/decisiones/0028-borrado-definitivo-de-organizaciones.md).

## Decisiones
Las condiciones las eligió el usuario en los ADR 0025–0027 (SuperAdmin recomprobado, baja previa de 30 días, slug escrito, motivo, purga del historial, auditoría con slug y nombre, todo en una transacción). Particulares de esta ficha:
1. **Una función de base** `admin_delete_organization(actor, org, slug, reason)` (migración `20261102100000_borrado_de_organizaciones.sql`): solo `service_role`, lock de suscripción y organización (`FOR UPDATE`), llama a `private.purge_organization_price_history` (que hace cumplir los 30 días) y deja `organization.deleted` en la misma transacción. Devuelve `{price_history_purged, payments_kept}`.
2. **Storage después de la base:** el servidor borra `product-images/{org}/…` y `organization-logos/{org}/…` solo cuando la transacción se confirmó (`removeOrganizationFiles`, nunca lanza). Si falla, el aviso `?archivos=pendientes` y el registro del servidor llevan el id.
3. **No se borran** pagos, anulaciones, auditoría ni cuentas de Auth (solo las membresías, por cascada).
4. **Pantalla:** sección «Borrar definitivamente» en `/admin/organizaciones/{slug}`: tres estados (activa; de baja con menos de 30 días; lista) y, con el plazo cumplido, formulario con identificador escrito + motivo + casilla. `deactivatedAt` se lee de `audit_log`, no de `is_active`. Tras borrar, redirige a `/admin?borrada={slug}`.
5. **Auditoría en pantalla:** «Organización borrada» con nombre, id, pagos conservados y cambios de precio purgados (el id sirve para ubicar archivos de Storage y pagos).

## Aceptación
- [x] Solo un SuperAdmin borra: otra cuenta, un id inexistente o `null` → `not_platform_admin`; Dueño, Staff, anon y un SuperAdmin **con sesión** no llaman la función por la API (`42501`); sin EXECUTE para `anon`, `authenticated` ni `public`.
- [x] Sin baja auditada de 30 días o más no se borra: activa → `organization_still_active`; inactiva a mano → `deactivation_not_audited`; baja de menos de 30 días (también a un minuto del plazo) → `deactivation_too_recent`; reactivada después → se rechaza, y si se vuelve a dar de baja cuenta la nueva.
- [x] El identificador escrito tiene que ser el de la organización (otro, vacío, en mayúsculas, el de otra, nulo → `slug_mismatch`); motivo vacío, de más de 200 o nulo → `invalid_reason`; organización inexistente → `org_not_found`. Cada rechazo no deja huella (la organización, el historial, las sucursales, las membresías, los archivos y los triggers siguen; sin auditoría nueva).
- [x] Borrar quita la organización y todo lo que colgaba de ella (sucursales, categorías, platos, membresías, suscripción, historial de precios) y **una** auditoría `organization.deleted` con actor, slug, nombre, motivo y cifras; las auditorías anteriores siguen; los triggers de solo-agregado quedan encendidos.
- [x] Los pagos y las anulaciones se conservan (sin organización), el SuperAdmin los sigue leyendo y ninguna organización los ve; las cuentas del Dueño y del Staff siguen existiendo.
- [x] Se borran los archivos de **esa** organización en los dos buckets (carpetas de platos incluidas) y no los de otra.
- [x] Es atómico: si la transacción que llama falla después o se revierte, no se borra nada, no queda auditoría ni trigger apagado.
- [x] Dos borrados a la vez dejan una sola auditoría (el otro dice que ya no existe); un borrado y una reactivación a la vez no dejan una organización borrada y reactivada.
- [x] El slug se puede reutilizar y la organización nueva no hereda pagos ni auditoría; la ficha y la carta de la borrada responden 404.
- [x] Pantalla: no se ofrece activa ni con menos de 30 días; el identificador equivocado no borra y conserva el motivo; sin la casilla no se envía; borrar redirige a la lista con el aviso y el movimiento; sin desborde a 390 px (identificador de 64 caracteres y motivo de 200).

## Fuera de alcance
- Borrar las cuentas de Auth que queden sin ningún local (ítem aparte, a decidir con el usuario).
- Verificar el respaldo antes de borrar (la pantalla solo lo recuerda), reintentar solo la limpieza de Storage y mostrar pagos huérfanos en una pantalla.
- Cambiar el plazo de 30 días o la retención de 10 años (ADR 0026 y 0027).

## (C) Invariantes
1. Solo `service_role`, con un actor que sigue siendo SuperAdmin, ejecuta el borrado; la API no puede (privilegios y ACL probados).
2. No se borra nada sin baja auditada de 30 días o más, slug escrito y motivo; todo en una transacción con la auditoría: no hay borrado sin rastro ni rastro sin borrado.
3. Los triggers de solo-agregado no quedan apagados salga bien o mal la transacción.
4. Los pagos, sus anulaciones, la auditoría y las cuentas de Auth no se tocan.
5. Los archivos de Storage solo se borran después de que la organización dejó de existir.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| Error con SQLSTATE | Rollback: no se borra nada ni queda auditoría. Mensaje claro por causa. |
| Se pierde la respuesta (sin SQLSTATE) | `uncertain_change`: no se tocan los archivos; mirar la lista (si ya no aparece, se borró). Repetir es seguro: da «no existe». |
| Dos SuperAdmin a la vez | El lock serializa: el segundo recibe `org_not_found` (o `organization_still_active` si se reactivó antes). |
| Storage falla tras borrar | La organización ya no existe; aviso en la lista y registro del servidor con el id; limpieza manual de `product-images/{id}` y `organization-logos/{id}`. |
| Se corta el servidor entre la transacción y la limpieza | Archivos sueltos sin aviso. Se detectan comparando las carpetas de Storage con las organizaciones existentes. Riesgo aceptado (ADR 0028). |
| Borrado por error | **No se recupera**: solo el respaldo de `docs/operacion.md`. Por eso: 30 días de baja, identificador escrito, motivo y casilla; y la baja se puede revertir antes. |

## (C) Seguridad y permisos
- Amenaza: un Dueño o Staff borra su organización (o lo intenta por la API) → `EXECUTE` solo para `service_role` (ACL probada), `requirePlatformAdmin` en página y acción, recomprobación en la función.
- Amenaza: borrado accidental con un clic → plazo de 30 días comprobado en la base, identificador escrito comparado en la base, motivo auditado.
- Amenaza: borrar una organización viva o reactivada → la purga exige que la última baja auditada sea la vigente; el `FOR UPDATE` la serializa con la reactivación (probado con pedidos simultáneos).
- Límite aceptado (igual que ADR 0013): quien tenga la clave `service_role` puede invocar la función con cualquier `p_actor` SuperAdmin; la casilla de la pantalla es una guía, la autoridad es la base.

## Migración y rollback
`supabase/migrations/20261102100000_borrado_de_organizaciones.sql`: una función nueva y el `check` de `audit_log.action` ampliado. Aditiva, sin datos. Rollback en su cabecera (`git revert` + `pnpm db:reset` en local; en una base con datos, `drop function`). Las organizaciones ya borradas no vuelven.

## Evidencia
Base local (`pnpm db:reset` con la migración nueva y `pnpm db:types`), 2026-10-20; el commit probado se anota en «Revisión y aprobación»:
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK · `pnpm test` **680/680** (14 nuevas en `src/lib/admin/delete-organization.test.ts`: plazo de 30 días, limpieza de Storage con carpetas, paginación y fallos, validación y traducción de errores, y que Storage solo se toca después de la base).
- `pnpm test:rls` completo **835/835** (37 archivos). `tests/rls/borrado-de-organizaciones.rls.test.ts` **22/22** (quién puede, rechazos sin huella, borrado, pagos y cuentas conservados, Storage, atomicidad, concurrencia); `acl.rls.test.ts` suma la función nueva (18/18). Un primer intento del archivo cayó con `0xC0000409` (worker ajeno al cambio) y se repitió: pasó.
- E2E (`--workers=1`, contra el build): `e2e/superadmin-borrado.spec.ts` 2/2 (plazo, identificador equivocado, casilla, borrado, aviso, movimiento, 404 de ficha/carta/panel, 390 px) y las specs de SuperAdmin vecinas (`superadmin-addons-baja`, `superadmin-planes-pagos`) 21/21. **No se corrió la suite E2E completa**: el cambio solo toca `/admin`.
- **Mutaciones** (de a una, con `create or replace` en la base local, restauradas después): 9 probadas, **9 detectadas** tras agregar una prueba. Sin recomprobar al SuperAdmin, sin comparar el slug, sin la purga ni el plazo (14 fallas), sin validar el motivo, auditoría con otra acción, auditoría sin el nombre, `EXECUTE` para `authenticated`, y sin el lock de la suscripción. Esta última **no se detectaba al principio** (21/21 pasaban): se agregó la prueba del pago que se registra a la vez (el borrado espera su lock y cuenta el pago en `payments_kept`) y ahora falla sin el lock. El `FOR UPDATE` de la organización no tiene prueba propia: la purga de `price_history` ya toma el lock equivalente (`NO KEY UPDATE`) y es lo que serializa con la reactivación.
- **No probado / límites:** staging y producción (nada aplicado ni desplegado); Storage real de Supabase hosted (solo el local); lector de pantalla y teléfono real; corte del servidor entre la transacción y la limpieza de Storage (riesgo aceptado); la casilla de confirmación no se verifica en el servidor (guarda de pantalla; la autoridad es la base); suite E2E completa.
