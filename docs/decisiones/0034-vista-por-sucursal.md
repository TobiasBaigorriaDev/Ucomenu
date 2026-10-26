# 0034 — Cada persona elige qué sucursales mira: la vista por sucursal es una preferencia, no un permiso

- Estado: aceptada (aprobada por el usuario y desplegada en staging el 2026-10-21)
- Fecha: 2026-10-21

## Contexto
Con dos sucursales que reciben llamados a la vez, todo el personal veía y recibía todo mezclado: la sala listaba los pendientes de **toda la organización** (decisión 3 de `panel-de-sala`), el cartel del panel, el contador del menú y el sonido salían del mismo sondeo, y el aviso push iba a **todas** las suscripciones de la organización (`push_targets_for_call`). Las mesas con el mismo nombre en dos sucursales se confundían. La membresía es **por organización** (ADR 0004 y 0005) y no hay forma de asignar una persona a una sucursal; la analítica era la única pantalla con selector de sucursal.

## Decisión
1. **Una preferencia por persona y local, no un permiso.** Tabla `member_branch_views` (una fila por persona y local; vale para todos sus dispositivos), sin permisos ni políticas por la API, con dos funciones: `set_my_branch_view` (solo miembros; solo sucursales activas del local) y `my_branch_view` (la vista **efectiva**). **Vacío = todas.**
2. **La membresía sigue siendo por organización.** Elegir una sucursal no amplía ni reduce lo que la persona puede leer o atender: por la API cualquier miembro sigue viendo y atendiendo los llamados de cualquier sucursal. La RLS de `waiter_calls`, `tables` y la carta no cambia.
3. **Todo lo que avisa sigue la vista:** la sala, el cartel del panel, el contador del menú y el sonido (mismo sondeo) y el **push**, que ahora descarta las suscripciones de quien eligió otras sucursales.
4. **Ante la duda, se avisa y se muestra.** Sin vista, con la lista vacía, o con sucursales que se desactivaron o borraron, la vista efectiva vuelve a «Todas» y el push avisa. Un aviso de más es preferible a un llamado sin atender.
5. **Red de seguridad:** la sala muestra cuántos llamados hay en las sucursales que no se miran (sin sonido ni región viva) con «Ver todas», y el cartel dice «Mostrando: …». `multiBranch` sigue siendo del local: la tarjeta nombra la sucursal aunque se filtre a una (igual que el texto del push).
6. **Cambiar la vista no suena ni anuncia lo que la pantalla ya había recibido** (y la vista anterior ocultaba); un llamado creado después de la última actualización sí se anuncia, aunque estuviera oculto (con horas del servidor, sin depender del reloj del dispositivo).
7. **La analítica** (solo Dueño) abre en la sucursal elegida si es exactamente una; `?sucursal=todas` fuerza «Todas».

## Alternativas consideradas
- **El Dueño asigna sucursales a cada Staff, con restricción real** (tabla de asignación y RLS de `waiter_calls`, `tables`, push y analítica): es otro modelo de autorización (revierte decisiones de 0004/0005 y `panel-de-sala`), nivel C completo y bastante más grande. Queda como un cambio aparte; este diseño no lo bloquea (la vista efectiva podría pasar a ser lo asignado). Primer paso hecho el 2026-10-26, solo en pantalla y sin RLS: [personal por sucursal](../../agile/cambios/personal-por-sucursal.md); la restricción real sigue pendiente en el tablero.
- **Guardar la elección en el navegador** (`localStorage`/cookie): no la ve el servidor, que es quien decide a quién mandar el push; y la elección sería distinta en cada dispositivo.
- **Una columna en `memberships`**: esa tabla solo la escribe el servidor con `service_role`; una tabla propia con función evita darle a la persona escritura sobre su membresía.
- **Filtrar solo en la pantalla**: el push seguiría avisando de todo, que era parte del problema.

## Consecuencias
- Quien filtra deja de recibir (en pantalla, con sonido y en el celular) los llamados de las demás sucursales: es lo pedido, y el riesgo de un llamado olvidado se compensa con la línea «en otras sucursales», «Mostrando: …» y el valor por defecto «Todas».
- `push_targets_for_call` solo puede **reducir** destinatarios y no devuelve datos nuevos.
- Un sondeo más por ciclo para los locales con más de una sucursal (la lectura de la vista); con una sola no se consulta.
- Migración nueva `20261106100000_vista_por_sucursal.sql`; su rollback exige desplegar primero el código anterior. Staging no la tiene.
