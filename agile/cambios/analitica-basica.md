# Cambio: Analítica básica — platos más vistos y llamados por franja horaria
Estado: implementado y probado en local; falta la revisión independiente de Codex y la aprobación del usuario antes de aplicar la migración a staging
Nivel: **C** (el tablero lo marcaba M; se sube por criterio: suma una **función que escribe y puede llamar cualquiera sin sesión**, una tabla nueva con su política de acceso, una lectura de datos de negocio solo para el Dueño y un cambio en lo que la carta promete en la política de privacidad. «Ante duda, subí un nivel»)

## Objetivo
Que el **Dueño** de un local con plan **Pro o Premium** vea, en una pantalla nueva del panel (`/panel/{slug}/analitica`), (1) **qué platos se miran más** y (2) **a qué horas llaman más las mesas** (al mozo y para pedir la cuenta). Está prometido desde `docs/producto.md`: «Analítica básica (platos más vistos, llamados por franja) — incluida desde el plan Pro».

## Decisiones
- *(usuario, 2026-10-18, las tres opciones recomendadas)* **«Plato visto» = el comensal abre el detalle del plato**, una vez por plato y por visita. **Los llamados por franja usan los últimos 14 días** (lo que ya se guarda; no se toca la purga ni su política). **Solo el Dueño ve la analítica.**
- **Vistas de platos: contadores por día, nunca eventos.** Tabla `dish_view_counts (organization_id, branch_id, product_id, day, views)`, clave `(branch_id, product_id, day)`. No guarda IP, ni identificador del comensal, ni hora exacta: solo «este plato, en esta sucursal, ese día, N veces». El día es el de Argentina.
- **Sin acceso directo a la tabla:** RLS activada, sin políticas y sin permisos para nadie (ni `service_role`); se escribe y se lee solo con funciones (patrón de `push_subscriptions`).
- **Quién puede escribir:** `record_dish_view(p_branch, p_product)` es **pública** (la llama la carta sin sesión, a través de una acción del servidor) y **valida adentro**: sucursal activa, plato activo de esa misma organización, cuenta no suspendida y plan con `analytics`. Si algo no cuadra devuelve `false` sin escribir y sin revelar cuál fue la causa. Suma 1 al contador de ese día con tope de 1.000.000 (no desborda).
- **Abuso aceptado, acotado:** cualquiera puede inflar contadores de la carta de un local llamando a la función (como cualquier contador público). No daña datos ni cuentas, solo el número; no se agrega límite por IP porque exigiría guardar un identificador del comensal, justo lo que se evita. Queda anotado como riesgo conocido; si apareciera abuso real, se agrega un tope por sucursal y hora.
- **El cliente no guarda nada:** la carta promete «no usa cookies ni guarda información en tu dispositivo». El «una vez por plato y por visita» se hace **solo en memoria de la página** (se pierde al recargar); no se usa `localStorage` ni `sessionStorage`. La carta de un local sin el plan no llama más después de la primera respuesta `false`.
- **Lectura solo para el Dueño actual con el plan:** `owner_top_dishes(p_org, p_days, p_branch, p_limit)` y `owner_calls_by_hour(p_org, p_branch)`. Dueño de otra organización, Staff, sin rol, anon, un local sin `analytics` o suspendido: cero filas. Con la cuenta vencida en «solo lectura» **sí** se ve (la regla del plan: `analytics` sigue disponible), igual que `menu`.
- **Llamados por franja:** se cuentan los llamados creados en los **últimos 14 días** por hora del día (Argentina) y por tipo (mozo / cuenta), de `waiter_calls`. No se lee `client_key`. Con menos de 14 días de vida del local se aclara. Ver ADR 0014: no hay histórico más allá.
- **Pantalla:** `/panel/{slug}/analitica`, solo Dueño (enlace «Analítica» en «Gestión»). Barras hechas con CSS (sin librerías), con una tabla accesible equivalente; filtro de sucursal si hay varias; vacíos explicados; con el plan Básico, un aviso de que está incluida desde Pro.
- **Política de privacidad:** se agrega una oración a `/privacidad`: la carta cuenta cuántas veces se abre cada plato, sin identificarte, sin cookies y sin guardar nada en tu dispositivo. **El texto legal ya está pendiente de revisión legal (ítem «Salida a producción»): este cambio se suma a lo que se le entrega.**

## Aceptación
- [x] Abrir el detalle de un plato en la carta pública de un local Pro suma **una** vista del día para ese plato y sucursal; abrirlo otra vez en la misma visita no suma; recargar y abrirlo, sí.
- [x] Un local Básico, suspendido, con sucursal inactiva, con un plato de otra organización o inactivo, o con ids inexistentes: no escribe nada y la carta no muestra error ni demora.
- [x] La carta no usa `localStorage`, `sessionStorage` ni cookies para esto (comprobado en el navegador).
- [x] El Dueño de un local Pro ve «Platos más vistos» (hasta 10, con total de vistas del período) y «Llamados por hora» (24 horas, mozo y cuenta); con varias sucursales puede filtrar.
- [x] Staff, Dueño de otro local, sin rol y anon no reciben ni una fila de ninguna de las dos lecturas; el Staff no ve el enlace y la dirección lo devuelve al panel.
- [x] Un local Básico ve el aviso «incluida desde el plan Pro» y no se le consulta nada; un local Pro vencido en «solo lectura» sigue viendo; suspendido, no.
- [x] La tabla `dish_view_counts` no se lee ni se escribe por la API (ni por `service_role`); no guarda datos del comensal.
- [x] Las lecturas no escriben nada. Los llamados fuera de los 14 días no se cuentan.
- [x] 390 px sin desborde; los gráficos tienen alternativa en texto; textos en español.
- [x] La política de privacidad menciona el conteo.

## Fuera de alcance
- Histórico de llamados más allá de 14 días (necesita agregar antes de purgar), rangos de fechas elegibles, exportar, gráficos de tendencia, comparar sucursales, analítica de búsquedas o de visitas a la carta, límites por IP, y analítica para el Staff.

## Evidencia
Ejecutado el 2026-10-18 sobre la rama `feat/analitica-basica` (base local reseteada con la migración `20261027100000`):
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK.
- `pnpm test` **594/594** (nuevas: `src/lib/analitica/lectura.test.ts`, 18: lectura defensiva de las dos respuestas, 24 horas completas con ceros, hora pico y empates, rango «13 a 14 h», anchos de barra y plurales).
- `pnpm test:rls` completo **709/709** (31 archivos; una primera corrida completa mostró 33 pruebas sin pasar en un archivo que no se identificó y la repetición pasó entera: se anota como falla ajena/de carga, sin causa conocida). `analitica.rls.test.ts` **14/14**: contador por día de Argentina sin ninguna columna del comensal; vistas con sesión y con la cuenta en «solo lectura»; 11 casos que no escriben nada y devuelven `false` sin error (plan Básico, cuenta suspendida, organización o sucursal o plato o categoría inactivos, plato de otra organización, sucursal de una y plato de otra, ids inexistentes o nulos); tope de 1.000.000; 12 vistas simultáneas suman 12; la tabla no se lee ni escribe por la API ni por `service_role`; ranking con total, filtro por sucursal, ventana de días y tope de 90, plato desactivado fuera de la lista pero dentro del total; Staff, Dueño de otro local, sin rol, anon, Básico y suspendida reciben cero filas (en «solo lectura» sí); quien deja de ser Dueño deja de ver; llamados por hora de Argentina y por tipo, sucursal y 14 días; sin datos del comensal en la respuesta; leer no escribe. `acl.rls.test.ts` **18/18** con las tres funciones registradas.
- **Mutaciones sobre las funciones y la tabla: 25 defensas rotas de a una, 25 detectadas** (registrar: sin plan, sucursal inactiva, organización inactiva, plato de otra organización, plato inactivo, categoría inactiva, sin tope, sin permiso para anon; tabla con RLS apagada y lectura abierta; ranking: sin Dueño, sin plan, de todas las organizaciones, sin ventana, sin máximo de 90 días, platos inactivos, sin filtro de sucursal, sin mínimo de límite, anon con permiso; llamados: sin Dueño, sin plan, de todas las organizaciones, sin ventana de 14 días, sin filtro de sucursal, hora en UTC, anon con permiso). Dos tropiezos del procedimiento, no del código: la primera versión del script deshacía la mutación de la tabla (se corrigió y se repitió: detectada) y una mutación figuró «no detectada» una vez y en dos repeticiones y a mano fue detectada (se anota).
- `playwright test e2e/analitica.spec.ts` y vecinas (`carta`, `menu`, `legal`, `buscador`, `disponibilidad`, `ticket-de-visita`, `llamados`, `opciones`, `identidad`, `sucursales`) con `--workers=1`: **109/109**. Las 7 de `analitica.spec.ts`: la carta cuenta una vista por plato y por visita, recargar es otra visita, **sin `localStorage`, `sessionStorage` ni cookies**; el plan Básico hace un solo pedido y no guarda nada; una sucursal inactiva no cuenta; el Dueño ve ranking, hora pico, gráfico de 24 barras y tabla equivalente, filtra por sucursal e ignora un filtro inventado, a 390 px sin desborde; vacíos; plan Básico con el aviso; el Staff no ve el enlace y es devuelto al panel. Capturas a 390 y 1280 px revisadas.
- **No ejecutado:** aplicar la migración a staging (espera la revisión y tu aprobación), ver la pantalla con datos reales de un local en uso.

## (C) Invariantes
1. Solo un **Dueño actual** de la organización, con el plan que incluye `analytics` y la cuenta no suspendida, recibe filas de ESA organización; cualquier otra identidad, cero filas.
2. `dish_view_counts` **no contiene datos del comensal** (ni IP, ni identificador, ni hora exacta) y no se lee ni escribe por la API: la única escritura es `record_dish_view`, que solo suma 1 a un contador válido.
3. `record_dish_view` **nunca** crea una fila para una organización sin el plan, una cuenta suspendida, una sucursal o plato inactivos, ni cruza organizaciones (plato de una, sucursal de otra).
4. La carta pública **no guarda nada en el dispositivo** por esta función y un fallo del conteo no afecta lo que se ve ni la carga.
5. Las lecturas de analítica solo leen; no devuelven `client_key`, ids de personas ni datos de otras organizaciones.

## (C) Fallos y recuperación
- **El conteo falla** (red, base caída): la acción devuelve un resultado vacío y la carta sigue igual; la vista de ese momento se pierde (es una estadística, no un dato de negocio).
- **La lectura falla:** la pantalla dice «No pudimos leer esta sección» por sección, sin bloquear el panel.
- **Contadores inflados por abuso:** se pueden poner a cero por SQL (`delete from dish_view_counts where ...`, solo propietario de la tabla); no hay datos personales que limpiar.
- **Rollback:** `git revert` y, en una base con datos, `drop function` de las tres funciones y `drop table public.dish_view_counts;` (solo se pierde la estadística).

## (C) Revisión y aprobación
Pendiente (revisión independiente de Codex; aprobación del usuario antes de aplicar la migración a staging).
