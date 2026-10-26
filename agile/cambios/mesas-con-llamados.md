# Cambio: Llamados dentro de «Mesas» (una sola pantalla para el mozo)
Estado: **hecho en local (2026-10-26); sin subir ni desplegar**. Falta tu prueba con sesión real y en teléfono. Sin migración.
Nivel: **M** — reorganiza pantallas y reutiliza lo que ya existe (atender un llamado, vista por sucursal, sonido, aviso push); no cambia permisos, planes ni dinero. Sin revisión independiente por defecto.

## Objetivo
Que el mozo trabaje en **una sola pestaña**: en `/sala/{slug}/mesas` ve qué mesas llaman o piden la cuenta, las marca como atendidas ahí mismo y anota el pedido, sin saltar a «Sala en vivo». Pedido del usuario (2026-10-26).

## Decisiones (particulares)
1. **Se elimina la pantalla «Sala en vivo» (lista de llamados) de la navegación de la Sala**, que queda con **Mesas** y **Panel**. `/sala/{slug}` redirige a `/sala/{slug}/mesas`: siguen valiendo el manifiesto de la app, los enlaces de las notificaciones push y los favoritos.
2. **Mesas absorbe todo lo que hacía esa pantalla:** «Atendido» en cada llamado de la tarjeta, sonido y pantalla encendida, resaltado y anuncio de los llamados nuevos, aviso del sistema (push), selector de sucursales, aviso de «llamados en otras sucursales que no estás mirando», título de la pestaña con el contador, escaneo del QR y señal de espera larga.
3. **Un solo sondeo:** `/sala/{slug}/mesas/estado` suma a cada mesa sus llamados (con id) y la cantidad de pendientes de las sucursales que no se miran. La lectura de pendientes se extrae de `loadSala` a un ayudante compartido (`llamados-loader.ts`); `/sala/{slug}/estado` queda para el cartel de llamados del panel, sin cambios de contrato (el campo nuevo es aditivo).
4. **Plan:** los llamados se leen solo si el plan concede `waiter_call`; la pantalla se habilita, como hoy, con `orders`. Pro y Premium tienen ambas, así que en la práctica se activan juntas. Caso de borde: una vista previa de `orders` en un plan sin llamados muestra las mesas sin llamados. El aviso de «no disponible» ahora nombra llamados, mesas y pedidos.
5. **Una mesa dada de baja con un llamado pendiente** (vence solo a los 30 min) sigue apareciendo mientras dure, como en la lista anterior.
6. **Orden:** el que ya tenía `sortMesas`: primero las que piden la cuenta, después las que llaman (la que más espera arriba), después con pedido y al final las libres.
7. **El enlace «Sala en vivo» del panel** (grupo «Servicio», con la alerta y el contador) apunta a Mesas; el cartel de llamados también.

## Aceptación
- [x] La navegación de la Sala tiene Mesas y Panel; `/sala/{slug}` redirige a Mesas.
- [x] Una mesa que llama o pide la cuenta muestra cada llamado con su espera, «Atendido» lo saca y otra pantalla lo ve desaparecer; dos personas a la vez: una atiende y la otra se entera.
- [x] Los llamados nuevos resaltan, se anuncian (una sola región viva) y suenan con las alertas activadas; los que ya había al cargar o al cambiar de sucursales no.
- [x] Con varias sucursales: selector, anuncio con la sucursal y aviso de pendientes en otras sucursales.
- [x] El aviso del sistema (push) se activa desde Mesas; su notificación abre `/sala/{slug}`, que redirige a Mesas (el contenido de la notificación no cambió).
- [x] Sin plan (Básico), en solo lectura o suspendida: aviso en lugar de la lista, sin sondeo.
- [x] A 390 px sin desborde y con botones de 44 px.
- [x] El cartel del panel sigue igual (consulta `/estado`).

## Fuera de alcance
Cambios de esquema o de planes; rediseño visual de las tarjetas más allá de sumar los llamados; el cartel del panel.

## Evidencia
Sobre el diff sin commitear de `main` (2026-10-26):
- `pnpm typecheck` y `pnpm lint` limpios; `pnpm build` en verde; `pnpm test`: 75 archivos, 1180 de 1180 (nuevas: `flattenCalls`, lectura de llamados con id y escaneo, `othersPending`).
- E2E contra el build, 15 archivos que tocan la Sala o el panel (`sala`, `sala-mesas`, `sala-push`, `sala-anotar`, `sala-operar`, `sala-precuenta`, `sala-turno`, `panel-llamados-aviso`, `panel-push`, `acceso`, `alta-guiada`, `aviso-iphone`, `reinicio-programado-qr`, `ticket-de-visita`, `superadmin-addons-baja`): 148 de 150 en la primera corrida; las dos fallas, repetidas: «sondeo lento» pasó 3 de 3 sola (falla solo con la máquina cargada por 11 *workers*, un cronometraje de 2,5 s) y «Todas las sucursales de la analítica» fallaba por una aserción desactualizada (el enlace de la analítica ya lleva `&dias=30`; no es de este cambio): se ajustó la expresión y pasa.
- Pruebas nuevas en `sala-mesas`: la Sala entra en Mesas y su navegación es solo Mesas y Panel; «Pide la cuenta» se atiende junto al total; una mesa de baja con un llamado pendiente sigue a la vista; el contenido de `/mesas/estado` (llamados con id y escaneo, `othersPending`, sin el token del QR).
- Revisado el diff y una captura a 390 px (tarjetas con «Atendido», sin desborde).
- Sin probar: sesión real y teléfono; staging.
