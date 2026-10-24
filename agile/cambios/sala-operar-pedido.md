# Cambio: Operar el pedido desde la Sala (estados, modificar, cancelar, cerrar y anular)
Estado: **implementado, aprobado por el usuario (2026-10-24, tras probarlo en local) y desplegado en staging (Fly versión 48)**; falta probarlo con sesión real en staging. No hay migración. Sexta pieza de S3 «Pedidos del mozo» ([ADR 0041](../../docs/decisiones/0041-pedidos-del-mozo.md), decisiones 3 y 5), segunda mitad del ítem «Anotar y operar pedidos desde la Sala»; la primera es [anotar](sala-anotar-pedido.md). Usa las cuatro funciones de [estados y registro](pedidos-estados-y-registro.md) (ya en staging).
Nivel: **M** — solo pantalla sobre funciones ya revisadas (C): las transiciones, el motivo obligatorio y la autorización (plan, mora) los decide la base. Sin esquema, permisos ni dinero nuevos. Sin revisión independiente por defecto.

## Objetivo
Que el mozo lleve el pedido de la mesa sin salir de su pantalla: marcar las líneas **en cocina** y **entregadas**, **modificar** una línea anotada, **cancelar**, y **cerrar** o **anular** el pedido.

## Decisiones (particulares)
1. **Pantalla reordenada** (misma ruta `/sala/{slug}/mesas/{mesa}/anotar`): arriba el pedido con las acciones de cada línea; abajo una **barra fija** con el total y dos botones, «Anotar plato» y «Cerrar / anular». La **carta pasó a una hoja** (`<dialog>` modal) que se abre desde «Anotar plato» y **queda abierta tras anotar** para seguir con el próximo plato («Listo» la cierra); el panel del plato se apila encima. Ninguna regla cambia respecto de la ficha de anotar.
2. **Acciones por línea según su estado** (`lineMoves`, reflejo de la base): anotada → «En cocina», «Entregado» (directo, sin cocina), «Modificar», «Cancelar»; en cocina → «Entregado», «Cancelar»; entregada → «Cancelar»; cancelada → ninguna. El estado se lee también en texto, no solo por color.
3. **Cancelar siempre se confirma** (hoja con la línea y su importe); el motivo es opcional salvo en una línea **ya entregada**, donde es obligatorio (el botón queda deshabilitado hasta escribirlo, y la base lo exige igual). El motivo de una línea cancelada se ve en ella.
4. **Modificar** cantidad (1 a 99) y observación solo de una línea **anotada**; vaciar la observación la quita. El plato y las opciones no se cambian: se cancela y se anota otra (así lo anotado nunca se recalcula).
5. **Cerrar** (lo normal) resume platos y total y **avisa si hay platos sin entregar** (decide el mozo); **anular** pide un motivo obligatorio y avisa que no se deshace. Ambos dejan la mesa libre y vuelven a «Mesas». No es una factura (la precuenta es de la ficha de cierre).
6. **Cerrar y anular no dependen del plan ni de la mora** (ADR 0041): si el plan ya no incluye los pedidos pero la mesa tiene uno abierto, la pantalla lo **sigue mostrando** (sin carta ni acciones de línea) con «Cerrar / anular». *No hay forma de llegar a esa mesa desde «Mesas» en ese estado (la vista muestra el aviso de plan): se entra por la URL; queda para la ficha de cierre.*
7. **Cuatro acciones del servidor** (`setLineStatusAction`, `updateLineAction`, `closeOrderAction`, `voidOrderAction`): exigen sesión y membresía del local, **validan la forma** de la entrada, comprueban con la RLS que la línea o el pedido **sean de ese local** y llaman a la función de la base con el cliente de la persona. Las excepciones conocidas se traducen a mensajes; un error desconocido nunca se toma por éxito.
8. **Reintento y concurrencia:** repetir un cambio ya aplicado devuelve `unchanged` y cuenta como hecho. Si otra persona ya cambió la línea (`invalid_transition`, `order_not_open`, `item_not_editable`, línea borrada) o no se sabe si se aplicó, la pantalla lo dice y **se recarga** con el estado vigente. No hay copia local del pedido: el servidor es la fuente.
9. **Línea cancelada visible:** el pedido muestra también lo cancelado (tachado, sin sumar), con su motivo; `AnotarData` suma `orderId` y las líneas `cancelReason`.

## Aceptación
- [x] Una línea avanza anotado → en cocina → entregado, o directo a entregado; la entregada solo ofrece cancelar; el resumen cuenta en unidades.
- [x] Modificar cantidad y observación de una anotada actualiza línea y total; sin cambios no se puede guardar; vaciar la observación la quita; una línea en cocina o entregada no ofrece modificar.
- [x] Cancelar pide confirmación; una anotada se cancela sin motivo; una entregada exige motivo (visible después en la línea); lo cancelado no suma y no ofrece más acciones.
- [x] Cerrar avisa de los platos sin entregar, libera la mesa y vuelve a «Mesas»; el pedido queda `closed` con su hora; la mesa admite uno nuevo.
- [x] Anular exige motivo, deja `void` con el motivo y la mesa libre.
- [x] Si otra persona ya cambió la línea, lo dice y muestra el estado vigente sin pisarlo.
- [x] Con el plan sin pedidos y un pedido abierto: se ve el pedido, sin carta ni acciones de línea, y se puede cerrar.
- [x] A 390 px, sin desborde horizontal, hojas legibles; la barra fija no tapa el contenido.

## Fuera de alcance
- Precuenta «no válida como factura», retención y purga (ficha de cierre); reabrir un pedido cerrado; mover líneas entre mesas; llegar a una mesa con pedido abierto cuando el plan ya no incluye los pedidos (desde «Mesas»); sonido o aviso a cocina; Realtime o sondeo en esta pantalla.

## Evidencia
Sin migración; base local, 2026-10-24, sobre `e5cb7c1` + el diff de este cambio:
- `src/lib/sala/operar.test.ts` (nuevo) **9/9**; con `anotar.test`, `mesas.test` y `sala.test`: **57/57**. Transiciones por estado, motivo obligatorio, forma de la entrada de las cuatro acciones, mapa de errores y cuáles piden recargar.
- `tests/rls/sala-anotar.rls.test.ts` **11/11** (eran 9): suma el motivo de cancelación y el id del pedido, un pedido abierto sin líneas vivas (se puede cerrar), y el pedido que sigue visible y **cerrable** con el plan bajado a Básico.
- `e2e/sala-operar.spec.ts` (nueva) **7/7** a 390 px (sin desborde) con las acciones reales contra la base: estados (con y sin cocina), modificar (y quitar la observación), cancelar (con y sin motivo), cerrar (aviso de sin entregar, mesa libre, pedido `closed`), anular (motivo, `void`), cambio concurrente (la línea ya entregada por otro mozo: mensaje y estado vigente) y plan Básico con pedido abierto. Con `sala-anotar` (adaptada a la carta en hoja), `sala-mesas` y `sala-push`: **27/27**.
- Capturas a 390 px revisadas (pedido con barra fija, cancelar con motivo, cerrar con aviso, carta). El botón de las hojas dice «Volver» (con «Cerrar» chocaba con «Cerrar pedido»).
- `pnpm typecheck` y `pnpm lint`: limpios. `pnpm test`: 1038 de 1039; la única falla es `textos.test.ts` («Menufeed»), ajena. `pnpm build` correcto.
- **No corrido:** mutaciones (el cambio no toca dinero ni permisos: lo decide la base, ya mutada en su ficha), suite RLS y E2E completas, lector de pantalla, teléfono real, staging.
- Un `next dev` abierto mientras se hacía `pnpm build` rompió el servidor de las E2E (`ERR_CONNECTION_REFUSED`): detener el de desarrollo antes de correr E2E.
- **Despliegue (2026-10-24, aprobado por el usuario):** commit `73badde` en `origin/main`; `flyctl deploy -c fly.staging.toml --local-only --depot=false` con los cuatro argumentos públicos; **Fly v48** (`started`, control `1 passing`, máquina `78177dda131e38`). HTTP sin sesión: `/login` y `/m/la-bestia/centro` **200**; `/sala/…/mesas/{mesa}/anotar` **307** al login. Sin migración ni secretos tocados. No se probó con sesión real (los demos no tienen Dueño).
