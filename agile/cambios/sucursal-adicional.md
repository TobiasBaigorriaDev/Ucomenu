# Cambio: Sucursal adicional para el plan Pro
Estado: **implementado y verificado en local (2026-10-23)**; revisión independiente de Codex aprobada sin hallazgos; pendiente la aprobación del usuario antes de aplicar la migración en staging.
Nivel: C (dinero y límites del plan; la cancelación desactiva sucursales)

## Objetivo
Que el SuperAdmin venda a una organización Pro hasta **3 sucursales adicionales a ARS 12.000/mes cada una**, cobradas junto con la suscripción, y que al cancelarlas no queden sucursales activas sin pagar. Motivos en [ADR 0039](../../docs/decisiones/0039-sucursal-adicional-y-vistas-previas.md).

## Decisiones
1. **Catálogo** (migración aditiva): `addons` gana el límite que concede (`grants_limit`: `branches` o nulo), `quota_per_pack`, `max_packs`, `price_cents` y `currency`. Fila `extra_branch`: `branches`, 1 por pack, máximo 3, 1.200.000 centavos, `ARS`, `allowed_plans = {pro}`. Las columnas de WebAR (`base_model_quota`, `pack_size`, `*_usd_cents`) dejan de usarse y la ficha de SuperAdmin deja de mostrar «modelos».
2. **Cupo:** `private.org_limit('branches')` = `plans.max_branches` + `extra_packs × quota_per_pack` del add-on vigente sobre un plan permitido. El trigger `enforce_branch_limit` y su *advisory lock* no cambian.
3. **Una función propia:** `admin_set_extra_branches(actor, org, cantidad 0–3, sucursales_a_desactivar uuid[], motivo)`, solo `service_role`, con la misma forma que el ADR 0025 (recomprueba al actor, lock de la suscripción, `audit_log`). Cantidad 0 = finalizar. Sin `ends_at`: el add-on dura hasta que se cambie.
4. **Desactivaciones exigidas** al bajar de N a M packs: `max(0, min(N − M, activas − tope_nuevo))`. Las sucursales elegidas tienen que ser de la organización, estar activas y ser exactamente esa cantidad; si no, `branches_selection_invalid` y no cambia nada. Se desactivan en la misma transacción y la auditoría lista cuáles.
5. **Cambio de plan con el add-on vigente:** a Premium, `admin_change_plan` lo finaliza en la misma transacción (sin desactivar: Premium no tiene tope); a Básico responde `extra_branches_must_end` y el SuperAdmin lo finaliza antes con su selección. La regla general «bajar de plan no borra» sigue para el cupo del plan.
6. **Lo que ve cada uno:** la ficha de SuperAdmin tiene cantidad, precio y selector de sucursales cuando hay que desactivar. La Suscripción del Dueño muestra «Sucursales: 3 de 3 (2 del plan + 1 adicional · ARS 12.000/mes)». En Sucursales, con el tope alcanzado, el Dueño de Pro lee «Pedí una sucursal adicional»; el Staff no ve precios. `owner_account_history` describe `addon.*` con cantidad y no con «packs».
7. **Pagos:** no cambian; el SuperAdmin registra un solo pago por plan + adicionales.

## Aceptación
- [x] Dado un Pro con 2 sucursales activas, cuando el SuperAdmin pone 1 sucursal adicional, entonces el Dueño crea (o reactiva) la 3.ª y la 4.ª da `53400` con el tope 3.
- [x] Dado un Básico o un Premium, cuando el SuperAdmin intenta poner sucursales adicionales, entonces recibe `addon_not_allowed` y nada cambia.
- [x] Cuando se piden 4, entonces `invalid_packs`.
- [x] Dado un Pro con 3 activas y 1 adicional, cuando el SuperAdmin la finaliza sin elegir sucursal, entonces `branches_selection_invalid` y no cambia nada; eligiendo una, queda desactivada, el add-on finalizado y una sola entrada `addon.ended` con la sucursal.
- [x] Dado un Pro con 2 activas y 1 adicional, cuando se finaliza, entonces no se exige desactivar nada.
- [x] Dado un Pro con 3 activas y 1 adicional, cuando el SuperAdmin pasa a Premium, entonces el add-on se finaliza en la misma transacción y las 3 siguen activas; a Básico, `extra_branches_must_end`.
- [x] Cuando dos altas de sucursal compiten por el último cupo, o un alta compite con la baja del add-on, entonces el resultado respeta el tope final (entra a lo sumo una o la baja exige otra selección).
- [x] El Dueño ve el add-on y su precio en Suscripción y en su historial; el Staff no ve precio ni cantidad; otra organización no ve nada.
- [x] El Dueño no puede escribir `addons` ni `subscription_addons` ni ejecutar la función (ni por la API ni con su sesión).
- [x] En mora, el cupo no cambia y las escrituras siguen bloqueadas por `org_can_write`, como hoy.

## Fuera de alcance
Cobro automático, prorrateo, fecha de fin programada, sucursales adicionales en Básico, add-ons de mesas o platos, desactivación automática sin elección.

## Evidencia
Sobre el diff de `main` (2026-10-23), migración `20261119100000`:
- `pnpm db:reset` y `pnpm db:types` con la migración nueva; `pnpm typecheck` y `pnpm lint` limpios; `pnpm build` en verde.
- RLS: `sucursal-adicional` 23/23 (catálogo; vender; Básico/Premium; 4 → `invalid_packs`; fórmula de desactivaciones incluida la del exceso heredado; selección ajena, inactiva, repetida o inexistente; cambio de plan; dos altas por el último cupo; alta y reactivación contra la baja del add-on; lo que ve cada rol; permisos; mora). Mutación: sin el advisory lock de `admin_set_extra_branches`, la prueba «reactivación contra la baja» falla. `acl` y `billing` actualizadas (función y fila nuevas) y en verde; `addons-y-baja`, `retiro-webar`, `limits`, `planes-pagos` y `desactivar-sucursales` siguen en verde en la corrida completa.
- Corrida completa de `pnpm test:rls` (52 archivos): 1136 de 1142 pruebas en verde; las 6 fallas eran las listas de `acl`/`billing` (corregidas) y `owner-lectura` (intermitente conocida: pasa sola).
- Unitarias: validaciones, errores de la base, mensajes del tope, desglose del Dueño e historial (`pnpm test` 907+ en verde; falla ajena conocida: `textos.test.ts`).
- E2E contra el build: `superadmin-sucursal-adicional` 3/3 (vender, el Dueño ve «2 de 3 (2 del plan + 1 adicional · ARS 12.000/mes)», quitar eligiendo cuál se desactiva, «Pedí una sucursal adicional» al llegar al tope, Básico/Premium sin formulario), más `superadmin-addons-baja`, `sucursales`, `desactivar-sucursales`, `cuenta-pagos-historial` y `superadmin-planes-pagos` en verde.
- Sin probar: staging y teléfono real.

## Decisiones tomadas al implementar
- La fila `extra_branch` lleva ceros en las columnas viejas de WebAR (siguen siendo `not null`); no se tocan.
- Finalizar conserva la fila y su cantidad (como el resto de los add-ons); el cupo se calcula solo con contratos vigentes sobre un plan que los admite, y `least(extra_packs, max_packs)` acota una fila fuera de rango.
- `admin_set_addon` / `admin_end_addon` quedan para add-ons futuros que no concedan cupo; con `extra_branch` responden `addon_has_own_action`.
- El precio del catálogo (`addons`) es legible por cualquier sesión como el de `plans`; lo que no se expone al Staff es la cantidad contratada (`subscription_addons` es del Dueño) y los datos de `org_entitlements`.

## (C) Invariantes
- Activas ≤ tope del plan + adicionales vigentes después de cualquier operación del add-on (el exceso tolerado es solo el heredado de un cambio de plan).
- Ninguna sucursal se borra; desactivar conserva mesas, QR, alias e historial.
- Plan, add-ons y su precio los escribe solo `service_role` desde una acción de SuperAdmin, siempre con `audit_log` en la misma transacción.

## (C) Fallos y recuperación
- Selección inválida o carrera con otra operación: la función falla entera (lock de la suscripción) y no queda nada a medias; el SuperAdmin relee y repite.
- Sucursal desactivada por error: el Dueño la reactiva si hay cupo, o el SuperAdmin vuelve a poner el add-on.
- Rollback de la migración: volver a las definiciones de `org_limit` y `admin_change_plan` anteriores y quitar la fila `extra_branch` (solo si no hay contratos vigentes; si los hay, finalizarlos antes).

## (C) Revisión y aprobación
- Diseño aprobado por el usuario el 2026-10-23 (D1–D4).
- Revisión independiente de Codex: 1 ronda sobre el commit `295046e` (nivel C, solo lectura, estática: no reprodujo las pruebas). Sin hallazgos; veredicto APROBAR. No reemplaza la aprobación humana.
- Pendiente: aprobación del usuario antes de aplicar la migración en staging.
