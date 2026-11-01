# Ventas ficticias para probar Analítica de La Bestia [M]

Solicitud y autorización: usuario, 2026-11-01. Solo datos ficticios de staging.

## Alcance y aceptación

- Proyecto `oasixhsdyigimwvcxtkx`, organización `la-bestia`, sucursal Centro.
- 80 días completos anteriores a hoy, zona Buenos Aires: 2026-08-13 a 2026-10-31.
- Volumen variable con fines de semana más fuertes y crecimiento gradual, mediodía y noche.
- Descuentos, anulaciones y líneas canceladas; dos platos sin ventas y vistas para explorar conversión.
- Conservar los pedidos previos, catálogo, precios actuales, planes y permisos. Ningún pedido nuevo abierto.

## Implementación y recuperación

[SQL del lote](../../tools/ventas-bestia-staging.sql), ejecutado con `pnpm exec supabase db query --linked --project-ref oasixhsdyigimwvcxtkx --file tools/ventas-bestia-staging.sql`.
No es una migración ni requiere despliegue. Transacción única, validación de destino, IDs deterministas y rechazo si ya existe el lote. Los triggers permanecieron activos; sus eventos técnicos se fechan al importar. No se falsificaron identidades en las ventas.

Los pedidos llevan `table_label LIKE 'Demo80d 20261101%'` y las líneas la nota `Venta ficticia - lote demo80d 20261101`. Las vistas se agregaron solo donde no había contador previo (sin sobrescribirlo). Un fallo de las comprobaciones antes de confirmar revierte la carga entera. Tras confirmar, cualquier limpieza requiere autorización y debe limitarse a los IDs del lote; conservar el registro técnico de solo agregado. No ejecutar una purga de la organización.

## Evidencia del SQL ejecutado (2026-11-01)

- 3.816 pedidos: 3.652 cerrados y 164 anulados; 15.293 líneas, 289 canceladas.
- 80 fechas con ventas. Los dos pedidos previos siguen fuera del lote.
- 144.572 vistas totales del local después de la carga.
- RPC reales de ventas y rendimiento de platos comprobadas con la identidad del dueño, solo en la transacción de consulta, para 7, 30 y 90 días.
- Ventas actuales según RPC: 296 pedidos en 7 días; 1.477 en 30; 3.654 en 90 (incluyen los 2 previos).
- La comparación anterior de 90 días queda en cero: se solicitaron 80 días de datos, no 180.
- Sin modificaciones de aplicación, build ni E2E: verificación SQL sobre el destino. Queda la prueba visual del usuario.
