# 0025 — Una organización se da de baja sin borrarla (cierra el acceso por RLS); los add-ons los gestiona el SuperAdmin con una función por acción

- Estado: aceptada (alcance y comportamiento elegidos por el usuario el 2026-10-19: baja completa, add-ons con packs y fin, sin borrado)
- Fecha: 2026-10-19

## Contexto
Quedaban dos acciones de SuperAdmin sin hacer: **add-ons** y **desactivar organizaciones**. Los add-ons ya tenían tabla (`subscription_addons`), catálogo (`addons`) y efecto (`plan_grants`, `org_limit('models_3d')`), pero nadie podía escribirlos desde la aplicación. `organizations.is_active` ya existía y la carta pública, los QR y los llamados ya lo filtraban, pero el Dueño y el Staff seguían entrando al panel y escribiendo: una «baja» que no cerraba nada. El **borrado** de organizaciones sigue bloqueado por diseño (ADR 0012: falta definir la retención de `price_history`, `payments` y `payment_voids`) y no entra en este cambio.

## Decisión
1. **Baja ≠ suspensión ≠ borrado.** La suspensión es de cobro y se levanta con fechas o a mano; la baja es del ciclo de vida de la cuenta: reversible, sin tocar la suscripción ni los pagos, y **cierra el acceso del local**. El borrado queda para después de decidir la retención.
2. **El acceso se corta en la raíz.** `private.is_org_member` y `private.is_org_owner` exigen `organizations.is_active`. Como todas las políticas, funciones de lectura del Dueño (`org_entitlements`, `owner_payments`, `owner_account_history`, analítica) y la lectura de membresías ya se apoyan en esas dos funciones, una organización dada de baja **no tiene miembros** a efectos de la base: nadie del local lee ni escribe nada por la API, sin repasar tabla por tabla. `private.org_state` devuelve además `suspended` (defensa en profundidad: `has_feature` y `org_can_write` fallan cerrados aunque algo los consulte directo, como el registro de avisos push, que comprueba la membresía por su cuenta).
3. **Qué ve cada uno.** El público: la carta y los QR no abren (404, igual que una organización inexistente: la regla vigente para `is_active = false`). Las personas del local: `/panel` y `/sala` dan 404 y, si era su único local, ven «Tu cuenta no tiene ningún local» (con una frase que menciona la baja); quien tiene otro local sigue entrando a ese. El SuperAdmin la sigue viendo en `/admin`, marcada «inactiva».
4. **Una función por acción** (ADR 0013), solo `service_role`, que recomprueba al actor y escribe `audit_log` en la misma transacción: `admin_set_organization_active` (`organization.deactivated` / `organization.reactivated`), `admin_set_addon` (`addon.activated` si no estaba vigente, `addon.changed` si lo estaba) y `admin_end_addon` (`addon.ended`). Motivo obligatorio (1 a 200). Errores estables como el resto.
5. **Reglas del add-on.** Solo sobre un plan que lo admite (`addons.allowed_plans`); packs extra de 0 a 50; fin opcional, futuro y a lo sumo 731 días; el lock de la suscripción serializa los cambios con el plan y los pagos; repetir lo mismo da `addon_unchanged` sin auditoría. Finalizar pone `ends_at = now()` y conserva los packs (reactivar es otra llamada). Bajar el plan después no borra la fila: `plan_grants` ya deja de conceder el add-on, y la ficha lo avisa.
6. **El Dueño ve lo que pagó, no el motivo.** `owner_account_history` suma `addon.*` (cuál, packs, fin) y `organization.reactivated` (sin detalle). La baja no figura: no podría verla.

## Alternativas consideradas
- **Solo ocultar la carta (lo que ya hacía `is_active`)** y dejar al Dueño en solo lectura: más suave, pero la baja no sería «baja» y el Staff seguiría tocando una cuenta cerrada. El usuario eligió cerrar el acceso.
- **Cortar el acceso en el servidor** (`requireMembership` mira `is_active`): esconde la pantalla pero deja abierta la API de datos. Descartada: la autoridad tiene que ser la base.
- **Que `org_state` devuelva un estado nuevo (`inactive`)**: obliga a tocar todo lo que enumera estados (`billing_state`, avisos, tipos del cliente) sin ganar nada, porque nadie del local llega a verlo. Se reutiliza `suspended`.
- **Modelar los add-ons con un historial propio** (una fila por contrato): más fiel, pero `subscription_addons` ya es una fila por organización y add-on con la regla de cupo apoyada en ella, y `audit_log` guarda cada cambio. Queda como evolución si hay que facturar por tramos.
- **Que `public_menu_status` devuelva «inactiva» y la carta diga «no disponible»:** mejor para quien escanea un QR de un local dado de baja, pero cambia una regla vigente (organización inactiva = no existe) y la función pública. Queda como mejora aparte.

## Consecuencias
- Dar de baja no libera el `slug`, ni borra sucursales, mesas, QR, fotos, historial de precios, pagos o auditoría. Reactivar devuelve todo; si la cuenta venció mientras estaba de baja, queda en la mora que dicen sus fechas.
- Los datos de una organización dada de baja siguen contando para sus propias reglas; el borrado y su retención son un ítem aparte del tablero (ADR 0012).
- Una escritura en vuelo de un miembro durante la baja puede terminar justo antes o justo después (nivel de aislamiento por defecto de Postgres); lo que ya se confirmó queda. No hay forma de «des-escribir», y no hace falta: la baja no borra nada.
- Reducir los packs o finalizar el add-on no desactiva por sí solo los platos 3D ya publicados: cuando exista el catálogo de modelos (fase 2) tendrá que decidir qué pasa con los que quedan por encima del cupo, como ya hace el tope de platos con el plan.
- Los avisos push ya registrados de una organización dada de baja no se borran: no se envían (el aviso comprueba el estado) y quedan listos para cuando se reactive.
