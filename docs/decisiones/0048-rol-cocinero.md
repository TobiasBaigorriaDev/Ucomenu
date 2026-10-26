# 0048 — Rol de cocinero: ve los pedidos, marca «listo» y agota platos, sin más permisos

- Estado: aceptada (alcance elegido por el usuario el 2026-10-26; implementación en curso)
- Fecha: 2026-10-26

## Contexto
Hasta ahora había dos roles (`owner`, `staff`) y los pedidos tenían el estado manual «En cocina», sin pantalla de cocina (ADR 0041, decisión 3 y límite de `docs/producto.md`). El usuario pidió un rol de **cocinero** que: reciba las órdenes, marque cuándo un plato está **listo para entregar** y **quite de la carta** lo que se agotó (ej.: se acabó la carne → sin hamburguesas). Eligió: flujo **Anotado → Listo → Entregado**; el cocinero solo ve y hace lo de cocina; **Pro y Premium**, todas las sucursales del local.

## Decisión
1. **Tercer rol `cook`** en `memberships.role`. Lo da y lo quita el **Dueño** desde Personal; solo se puede dar con la función `orders` en el plan.
2. **Cerrado por defecto.** `private.is_org_member` (que abre más de 130 políticas y todas las funciones del mozo) pasa a significar **Dueño o Staff**: un cocinero no hereda nada de lo que ya existe. Lo de cocina se concede aparte, con `private.is_org_kitchen` (Dueño, Staff o cocinero) y funciones propias.
3. **Superficie del cocinero = tres funciones `SECURITY DEFINER`** (sin acceso directo a tablas):
   - `kitchen_orders(p_org, p_branch)`: pedidos abiertos con sus líneas pendientes (anotadas y listas): mesa, plato, cantidad, opciones y observación. **Sin precios, totales ni datos de cobro** (los precios de la carta publicada son públicos para cualquiera; lo que no se agrega es nada del pedido).
   - `kitchen_menu(p_org, p_branch)`: platos activos y visibles de la sucursal con su disponibilidad. **Sin precios.**
   - `set_kitchen_availability(p_org, p_product, p_branch, p_available)`: escribe **solo** `is_available` de esa sucursal, con la cuenta editable.
   Marcar «listo» usa `set_order_item_status`, ampliada.
4. **Estados de línea:** `noted → ready → delivered`; cancelar sigue desde cualquiera. `in_kitchen` **se conserva en la base** (filas existentes y compatibilidad) pero la pantalla del mozo deja de ofrecerlo. El cocinero solo puede pasar a `ready` (desde anotada o en cocina) y **deshacer** `ready → noted`; no entrega, no cancela, no edita, no cierra ni anula.
5. **Plan y mora:** las acciones del cocinero exigen `orders` en el plan y la cuenta al día (igual que cambiar estados hoy); agotar un plato exige cuenta editable. En solo lectura o suspendida el cocinero ve el aviso y no opera.
6. **Pantalla propia `/cocina/{slug}`** (pedidos y disponibilidad), separada de la Sala y del panel. El cocinero **no entra** a `/panel` ni a `/sala` (redirige a `/cocina`); sus consultas a la Sala dan 404.
7. **Sin avisos del sistema (push) ni llamados** para el cocinero: al darle el rol se borran sus suscripciones push y no puede registrar otras.
8. Al mozo, «listo» le llega por el sondeo de Mesas: contador y resaltado «listos para entregar» en la mesa, y anuncio/sonido como un llamado nuevo.

## Alternativas consideradas
- **Dejar al cocinero como `staff` con otra etiqueta** — descartado: heredaría precios, mesas y pedidos (RLS por `is_org_member`).
- **Políticas RLS de lectura sobre `orders`/`order_items` para el cocinero** — descartado: RLS es por fila y expondría precios; las funciones devuelven solo lo necesario.
- **Cocinero atado a una sucursal** — descartado por ahora (columna nueva y pantalla de asignación); ve todas las del local con el selector actual. Resuelto después solo en pantalla: ver [personal por sucursal](../../agile/cambios/personal-por-sucursal.md).
- **Conservar «En cocina»** — descartado por el usuario: flujo más corto.

## Consecuencias
- Cambia `docs/producto.md` (roles y pantalla de cocina) y matiza el ADR 0041: ahora **sí hay pantalla de cocina**, para ese rol.
- `is_org_member` más estricta es una barrera para futuras tablas: lo nuevo nace cerrado para el cocinero.
- Los avisos de «cuenta» (precuenta) y `close_order` siguen siendo del mozo.
