# 0039 — La sucursal adicional es un add-on de cupo cobrado con la suscripción; las funciones nuevas se liberan por organización con vistas previas auditadas

- Estado: aceptada (recomendaciones D1–D5 aprobadas por el usuario el 2026-10-23; implementación pendiente)
- Fecha: 2026-10-23

## Contexto
Las organizaciones Pro tienen tope de 2 sucursales y el usuario quiere venderles sucursales adicionales a **ARS 12.000/mes** cada una. La infraestructura de add-ons (ADR 0025) existe pero está armada para WebAR: columnas `base_model_quota` y `pack_size`, precios en USD y catálogo vacío desde ADR 0031. `org_limit('branches')` solo mira el plan. La regla general «bajar de plan no borra, solo impide crear más» dejaría, al cancelar el add-on, sucursales activas sin pagar. Además, las funciones del incremento (promociones, pedidos, clientes) necesitan habilitarse en locales piloto antes que en todo un plan.

## Decisión
1. **Catálogo genérico.** `addons` deja de ser específico de WebAR: indica qué límite concede (`branches`), cuánto por pack (1), su precio en centavos **y su moneda** (`ARS` para este add-on; el catálogo de planes sigue en USD). El valor lo actualiza una migración, como el resto del catálogo.
2. **Cupo.** `org_limit('branches')` = tope del plan + packs del add-on vigente sobre un plan permitido. El add-on `extra_branch` solo se permite en **Pro**, con un **máximo de 3** sucursales adicionales (con más conviene Premium).
3. **Cobro y vigencia.** Se cobra **junto con la suscripción y sigue su ciclo** (mensual o anual): el pago manual cubre plan y add-on, y la mora es la de la organización. Este add-on **no usa `ends_at` automático**.
4. **Cancelación sin sucursales gratis.** Finalizar el add-on o bajar packs exige que las sucursales activas entren en el tope nuevo o, **en la misma transacción**, desactiva las que el SuperAdmin elige con el Dueño (desactivar es reversible y conserva mesas, QR e historial). Sin elección, no cambia nada. Pasar de Pro a otro plan finaliza el add-on en la misma operación.
5. **Vistas previas por organización.** Tabla aparte (`organization_feature_previews`), escrita solo por SuperAdmin con motivo, fecha de fin y `audit_log`; `plan_grants` = features del plan ∪ vistas previas vigentes. La mora sigue mandando (`has_feature`). Está separada de los add-ons para no aparecer en la facturación del Dueño.

## Alternativas consideradas
- **Mantener la regla general (conservar la sucursal al cancelar)** — deja capacidad paga sin cobrar. Descartada para recursos cobrados aparte.
- **Desactivar automáticamente la sucursal más nueva** — sorprende al local y puede apagar la equivocada. Se prefiere la elección explícita.
- **Precio del add-on en USD equivalente** — coherente con el catálogo, pero el usuario fijó el precio en pesos.
- **Vistas previas como add-ons de precio cero** — reutiliza tablas, pero mezcla pruebas con facturación.

## Consecuencias
- Cambiar `plan_grants` y `org_limit` toca todas las políticas: nivel C, con pruebas de mutación.
- La Suscripción del Dueño muestra plan + sucursales adicionales y su precio; `owner_account_history` ya contempla `addon.*`.
- El cobro automático (Fase 4 del tablero) tendrá que facturar plan y add-ons juntos.
- Un Pro con 5 sucursales cuesta más que Premium según el tipo de cambio: el tope de 3 lo acota.
