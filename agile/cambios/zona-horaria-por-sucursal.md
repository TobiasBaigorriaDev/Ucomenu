# Cambio: Zona horaria por sucursal
Estado: **implementado y verificado en local (2026-10-23).** Primera pieza de S2 (Promociones): las promociones y, después, los pedidos leen el reloj con la zona de cada sucursal ([ADR 0040](../../docs/decisiones/0040-promociones-programadas.md), decisión 1).
Nivel: **M** — una columna y un privilegio por columna. No toca dinero ni planes: la facturación y la mora **no cambian** (siguen en hora de Argentina). Todavía nada lee la columna; la lee la función de precio efectivo ([ficha siguiente](promociones-y-precio-efectivo.md)).

## Objetivo
Que cada sucursal tenga su zona horaria (por defecto Buenos Aires) y que el Dueño pueda cambiarla, para que las promociones —que se rigen por la hora del local— funcionen en una sucursal fuera de Argentina.

## Decisiones (particulares)
1. **Columna `branches.timezone`** (`text not null default 'America/Argentina/Buenos_Aires'`), migración `20261122100000`. Las sucursales existentes quedan en Buenos Aires, que es lo que ya usaba toda la base.
2. **Lista cerrada de 22 zonas** (Argentina, países vecinos, resto de Latinoamérica, cuatro de EE. UU., Madrid y Lisboa) en un `CHECK`, en vez de validar contra `pg_timezone_names`: un `CHECK` no puede consultar esa vista, y Postgres acepta nombres (`EST`, `posix/…`, `Etc/GMT+3`) que la aplicación no debe aceptar ni mostrar. Es la misma lista que `BRANCH_TIME_ZONES` de `rules.ts`; ampliarla es una migración (mismo criterio que los hosts de Google). Sin zonas con horario de verano ambiguo por fuera de la lista: el cálculo de promociones se prueba con las 22.
3. **Solo el Dueño la cambia**: `grant update (timezone)` a `authenticated` y la política vigente de UPDATE de `branches` (Dueño y cuenta al día). **El alta de sucursales no la fija** (el `grant insert` sigue en `organization_id, slug, name`): nace en Buenos Aires y se cambia después.
4. **Lectura pública** por el SELECT que ya tenían `anon` y `authenticated`, filtrado por la política de sucursales activas y publicadas; la carta la necesitará para decidir qué promoción rige.
5. **Pantalla**: en Sucursales, un renglón «Zona horaria: …» y un formulario plegado «Zona horaria» con un selector. El texto aclara que la facturación y los vencimientos no cambian.
6. **No se migran los usos existentes de Buenos Aires** (tema de fechas, analítica de llamados por hora, historial de precios, vencimientos): el ADR dice que la zona rige «solo la lógica operativa (promociones, pedidos)». Si el Dueño pide la analítica de llamados en su hora local, es otro cambio.

## Aceptación
- [x] Toda sucursal nace en Buenos Aires; el alta por la API no puede fijar otra.
- [x] El Dueño la cambia y la vuelve a cambiar; una zona fuera de la lista se rechaza con un mensaje claro y, si se salta la validación local, con `23514`. Nula tampoco (`23502`).
- [x] La validación local y el `CHECK` responden lo mismo a cada fila de la tabla de casos.
- [x] Postgres conoce cada zona de la lista y da la misma hora local que `Intl` (verano e invierno de ambos hemisferios) para cada una.
- [x] El Staff, el Dueño de otra organización y `anon` no la cambian; con la cuenta en solo lectura o suspendida, tampoco el Dueño.
- [x] La carta pública la lee solo mientras la sucursal está activa y publicada.
- [x] El estado de la cuenta (`org_entitlements`) es idéntico con cualquier zona de la sucursal.

## Evidencia
Migración `20261122100000`, sobre el diff de `main` (2026-10-23):
- `pnpm db:reset` y `pnpm db:types`; `pnpm typecheck`, `pnpm lint` y `pnpm build` en verde.
- RLS: `zona-horaria` + `acl` + `enlace-de-resenas` 45/45 (la lista de columnas actualizables de `acl` suma `timezone`).
- Unitarias de `src/lib/sucursales` 29/29. E2E `sucursales` 17/17 con la prueba nueva (cambiar a Madrid, recargar, sin desborde a 390 px).
- Staging (2026-10-23): migración `20261122100000` aplicada junto con la de promociones; commits en `origin/main`. La app todavía no está desplegada (Fly versión 37), así que el formulario no existe allí. No probado con sesión de Dueño en staging ni en un teléfono.

## Fuera de alcance
Usar la zona en promociones y pedidos (siguientes fichas); mostrar la hora local de la sucursal en otras pantallas; zonas fuera de la lista; dirección de la sucursal.
