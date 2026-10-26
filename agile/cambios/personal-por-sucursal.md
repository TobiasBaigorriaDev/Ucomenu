# Cambio: Personal por sucursal (solo pantalla)
Estado: desplegado en staging (Fly v62, migración `20261208100000`) el 2026-10-26; falta la prueba manual del usuario con sesión real
Nivel: M (decidido por el usuario el 2026-10-26: «por ahora solo limitarlo a lo que el mozo y el cocinero ven en pantalla, sin RLS; luego lo hago en nivel C»). La versión con restricción real es el ítem [C] del Backlog del tablero.

## Objetivo
El Dueño asigna una o más sucursales a un mozo (Staff) o cocinero. Esa persona solo ve en pantalla los pedidos, mesas, llamados, avisos y platos de esas sucursales. Sin asignación, todo sigue igual (ve todas).

## Decisiones
- **Dónde se guarda:** columna `memberships.assigned_branch_ids uuid[]` (vacío = sin restricción). La escribe solo el servidor con `service_role` desde Personal (ADR 0005, decisión 3); nadie la cambia por la API.
- **A quién alcanza:** Staff y cocinero. El Dueño nunca queda restringido aunque tenga la columna cargada.
- **Se acota lo que se LEE para mostrar**, no las tablas: `my_branch_view` (vista efectiva), `kitchen_branches`, `kitchen_orders`, `kitchen_menu`, `push_targets_for_call` y las pantallas de Sala (`loadMesas`, `loadSala`, anotar, precuenta). No cambia ninguna política RLS ni las funciones que **escriben** (`set_order_item_status`, `set_kitchen_availability`, `attendCall`…): por la API quien sepa un id ajeno sigue pudiendo actuar. Eso es lo que cubre el ítem [C].
- **La preferencia de vista (ADR 0034) sigue, dentro de lo asignado:** con dos sucursales asignadas elige entre ellas; «Todas» significa todas las asignadas. `set_my_branch_view` rechaza sucursales no asignadas.
- **Falla cerrado:** si todas las sucursales asignadas se desactivaron, la persona no ve nada (se usa un id imposible), nunca «todas».
- No se muestran nombres ni conteos de las sucursales ajenas (sin «hay N llamados en otras sucursales»).

## Aceptación
- [x] Dado un mozo asignado a la sucursal A, cuando abre Mesas, entonces solo ve mesas, pedidos y llamados de A, y el selector solo ofrece las asignadas.
- [x] Dado ese mozo, cuando abre por URL el anotar o la precuenta de una mesa/pedido de B, entonces ve 404.
- [x] Dado un cocinero asignado a A, cuando abre `/cocina`, entonces solo ve pedidos de A y en la carta de cocina solo la sucursal A.
- [x] Dado un llamado en B, cuando llega el aviso push, entonces no lo recibe el mozo asignado solo a A.
- [x] Dado un Dueño, cuando abre cualquier pantalla, entonces ve todas las sucursales.
- [x] El Dueño asigna y quita sucursales desde Personal; quitar todas deja a la persona sin restricción.
- [x] Una sucursal asignada que se desactiva no abre las demás.

## Fuera de alcance
- Restricción real (RLS y funciones de escritura): ítem [C] del tablero.
- Asignar sucursales a Dueños; asignar al crear la cuenta (se hace después, desde la fila de la persona).

## Evidencia
Migración `20261208100000_personal_por_sucursal.sql` (aplicada con `pnpm db:reset`; tipos regenerados). Diff probado: árbol de trabajo sobre `3c321dc`, antes de confirmar.
- `pnpm test`: 76 archivos, 1205 pruebas en verde (incluye `src/lib/sucursales/vista.test.ts` con los asistentes nuevos).
- `pnpm lint` y `pnpm typecheck`: sin errores.
- RLS (Supabase local), en verde: `personal-por-sucursal` (12: vista efectiva, preferencia dentro de lo asignado, Mesas y Sala sin nombres ni conteos ajenos, Dueño sin restricción, sucursal desactivada → nada, columna no editable por la persona, cocina, avisos push), `personnel` (39, con 4 nuevas de asignación), `acl` (22, con las dos funciones nuevas en la matriz), `rol-cocinero`, `vista-sucursal`, `sala-module`, `sala-mesas`, `push` y `desactivar-sucursales`.
- E2E tras `pnpm build`: `personal-por-sucursal` (3: el Dueño asigna desde Personal y el mozo solo ve esa sucursal, 404 por URL a la otra, cocinero asignado, sucursal desactivada), más `cocina`, `sala-mesas`, `llamados` y `desactivar-sucursales` en verde. `acceso.spec` falló en 10–11 pruebas al correrlo en paralelo con otras (el ingreso superó los 20 s bajo carga) y pasó completo (35/35) con `--workers=1`; no toca lo cambiado.
- **Staging (2026-10-26), aprobado por el usuario («Apruebo despliegue a staging»):** código de `a14dded`. `supabase db push --linked --dry-run` contra `oasixhsdyigimwvcxtkx` listó solo `20261208100000_personal_por_sucursal.sql`; aplicada con `db push --linked --skip-vault --yes`, sin seeds ni roles; dry-run posterior `upToDate: true`. Imagen `ucomenu-staging:personal-sucursal-a14dded` con `flyctl deploy -c fly.staging.toml --local-only --depot=false`: **Fly v62**, `started`, 1 passing. HTTP sin sesión: `/`, `/login`, `/privacidad` y `/m/la-bestia/centro` 200; `/panel/demo`, `/sala/demo/mesas` y `/cocina/demo` 307; `/cocina/demo/estado` y `/sala/demo/estado` 401. Un anónimo recibe `42501` en `my_branch_access` y `kitchen_branches`. Marcha atrás: imagen `ucomenu-staging:alimentaria-124bbc9` (v61) y, antes, el rollback de la migración descrito en su encabezado.
- No se corrió: la prueba con sesión real y teléfono en staging; la comprobación manual en navegador y teléfono (pendiente del usuario), ni E2E completo.

## Límites conocidos (los cubre el ítem [C] del tablero)
- Las escrituras no se restringen: `set_order_item_status`, `set_kitchen_availability`, atender llamados y anotar pedidos aceptan una sucursal ajena si alguien llama a la API con sus ids; la RLS de `orders`, `order_items`, `tables` y `waiter_calls` sigue por organización.
- `Panel → Mesas` (QR y alta de mesas) sigue mostrando todas las mesas del local al Staff: es configuración, no pedidos.
- Con una sola sucursal activa no hay nada que asignar: la fila de Personal no ofrece el control.
