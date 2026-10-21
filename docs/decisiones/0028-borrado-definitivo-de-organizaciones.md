# 0028 — El borrado definitivo de una organización es una sola función de base, tras 30 días de baja, con el slug escrito; los archivos se limpian después de confirmar

- Estado: aceptada (las condiciones las eligió el usuario el 2026-10-20 en los ADR 0025, 0026 y 0027; la limpieza de Storage, el aviso posterior y el alcance sobre las cuentas son decisiones técnicas de este cambio)
- Fecha: 2026-10-20

## Contexto
La baja de una organización es reversible y no borra nada (ADR 0025). Para el borrado definitivo había que decidir antes qué pasa con el historial de precios (ADR 0026: se purga con la organización) y con los pagos (ADR 0027: sobreviven 10 años). Con eso decidido y las funciones de purga listas, faltaba la acción en sí: es **eliminación irreversible** de la carta, las mesas y QR, las suscripciones y las membresías de un cliente.

## Decisión
1. **Una función de base** `public.admin_delete_organization(actor, org, slug, reason)`, solo `service_role`, `SECURITY DEFINER` con `search_path` vacío, mismo patrón que las demás acciones de SuperAdmin (ADR 0013). En **una transacción**: recomprueba que el actor es SuperAdmin, valida el motivo (1 a 200), toma los locks (suscripción y luego organización, `FOR UPDATE`, que serializa con la baja/reactivación, la purga y los pagos), exige que el `slug` escrito sea el de la organización, llama a `private.purge_organization_price_history` (que exige la **baja auditada de 30 días o más**), borra la organización (la cascada se lleva el resto) y deja la auditoría `organization.deleted`.
2. **La auditoría** guarda el slug y el nombre (con eso se identifican los pagos huérfanos, ADR 0027), el motivo, el actor y las cifras de lo que se fue (cambios de precio purgados, sucursales, platos, membresías) y de lo que se conservó (pagos y anulaciones). El id de la organización queda en `audit_log.organization_id` (sin clave foránea). Sin datos personales.
3. **Errores estables:** `not_platform_admin`, `invalid_reason`, `slug_mismatch`, `organization_not_found`, y los tres de la purga (`organization_still_active`, `deactivation_not_audited`, `deactivation_too_recent`). Cualquier rechazo revierte todo: no se borra nada ni queda auditoría.
4. **Storage después de la base.** La base no puede borrar archivos de Storage, y borrarlos antes dejaría a una organización que sigue existiendo sin sus fotos si la transacción fallara. Por eso el servidor, **después de confirmada la transacción**, borra por la API de Storage `product-images/{org}/…` y `organization-logos/{org}/…` (con la clave de servicio). No es parte de la transacción: si falla, la organización ya no existe y quedan archivos sueltos; la acción lo avisa (`?archivos=pendientes`), lo deja en el registro del servidor con el id y se repite la limpieza a mano.
5. **Qué NO se borra:** los pagos y sus anulaciones (ADR 0027), la auditoría, y **las cuentas de Auth** del Dueño y del Staff (una cuenta puede tener otros locales; solo se van sus membresías de esta organización). Una cuenta que quede sin ningún local es un tema aparte (ítem del tablero).
6. **Pantalla.** Sección «Borrar definitivamente» en `/admin/organizaciones/{slug}`: sin baja o con menos de 30 días explica por qué no se puede y desde cuándo; con el plazo cumplido pide el identificador escrito, el motivo y una casilla (que recuerda correr el respaldo). La fecha de la baja sale de `audit_log` (último evento de ciclo de vida), no de `is_active`. La base lo vuelve a exigir todo: la pantalla es una guía. Al terminar redirige a la lista con un aviso (la página de la organización ya no existe).

## Alternativas consideradas
- **Borrar desde la aplicación con varias llamadas** (purgar, borrar, auditar) — no es atómico: un corte entre medio deja una organización sin historial pero viva, o borrada sin auditoría.
- **Borrar los archivos antes, o dentro de un trabajo diferido** — antes arriesga fotos perdidas sin borrado; un trabajo diferido necesita una cola y un lugar donde recordar qué borrar, desproporcionado para un acto de baja frecuencia con una auditoría que ya guarda el id.
- **Borrar también las cuentas sin otros locales** — destruye identidades por una inferencia («no tiene otro local ahora»); se decide aparte, con el usuario.
- **Dejar que el slug sea reutilizable o reservarlo** — el borrado lo libera (no hay otra restricción); la organización nueva tiene otro id y no hereda pagos ni auditoría. Reservarlo habría sido una decisión de negocio que nadie pidió.
- **Exigir que el SuperAdmin escriba el nombre en vez del slug** — el slug es corto, único e inconfundible; el nombre admite acentos y duplicados.

## Consecuencias
- **Irreversible:** una vez confirmada la transacción las filas no vuelven; lo único que las conserva es el respaldo (`pnpm respaldo`, `docs/operacion.md`), que ningún paso de la acción verifica: la pantalla solo lo recuerda.
- **Archivos huérfanos posibles** si Storage falla justo después de borrar (caso raro, avisado y repetible a mano).
- **Pagos huérfanos a propósito:** quedan sin organización; se identifican con la auditoría `organization.deleted` (slug, nombre, id).
- **Bloqueo breve:** el `FOR UPDATE` frena un instante a quien escriba esa organización a la vez (después falla: ya no existe); apagar los triggers de `price_history` toma `SHARE ROW EXCLUSIVE` unos milisegundos (ADR 0026).
- **Sin programación:** nada borra solo; cada borrado lo pide un SuperAdmin con motivo.
