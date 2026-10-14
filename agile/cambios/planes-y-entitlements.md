# Cambio: Planes y entitlements — catálogo de planes, mora derivada, límites y bloqueo de escrituras
Estado: verificado; revisado por Codex (*aprobar con cambios*), correcciones aplicadas; pendiente de integrar a `main` tras confirmar la corrección
Nivel: C

## Objetivo
Que la **base de datos** decida qué puede hacer cada organización según su plan y el estado de su suscripción: qué funciones tiene, cuánto puede crear y si puede escribir. Cierra los riesgos que dejó el Núcleo multi-tenant (hoy un miembro puede superar el tope de platos y la mora no corta nada) y desbloquea «Gestión de carta» y «Acceso del personal».

## Decisiones del usuario (2026-10-14)
1. **Mora y escrituras:** en **solo lectura (días 8–15) y suspendida (16+)** quedan bloqueadas **todas** las escrituras de catálogo (`INSERT`, `UPDATE`, `DELETE` en categorías, platos, precios, sucursales y, cuando existan, mesas), para Dueño y Staff. En gracia (1–7) se edita normalmente. El panel y la carta pública (en solo lectura) siguen visibles.
2. **Alta:** toda organización nueva recibe la **prueba de 14 días del plan Básico** desde su fecha de creación. Los datos del seed deben seguir activos para las pruebas de lectura pública.
3. **Límites sobre activos:** con el tope alcanzado o superado se bloquea el `INSERT` de un plato activo **y** el `UPDATE` de inactivo → activo; activo → inactivo siempre se permite. Los registros no se borran al bajar de plan. Misma regla para sucursales y mesas.
4. **Fuera de este ítem:** `platform_admins`, `payments` y `audit_log` (van en «SuperAdmin»). Los datos de suscripción los escribe solo el servidor (`service_role`).

## Decisiones de diseño (derivadas; revisables)
- **Estado derivado, no guardado.** `fin = greatest(current_period_end, trial_ends_at)`. Con `t = now()`: `t ≤ fin` → `active`; `t ≤ fin + 7 días` → `grace`; `t ≤ fin + 15 días` → `read_only`; si no → `suspended`. Equivale a «día N = ⌈(t − fin) / 24 h⌉»: el día 7 es gracia, el 8 solo lectura, el 15 solo lectura, el 16 suspendida. Sin suscripción (o sin fechas) → `suspended` (falla cerrado).
- **Una suscripción por organización** (`unique (organization_id)`), creada por un *trigger* al dar de alta la organización (prueba de 14 días, plan `basic`). Se rellena también para las organizaciones ya existentes.
- **Catálogo en tablas, no en el código:** `plans` (precios en centavos de USD, límites, features) y `addons` (WebAR: precio, cupo base 15, packs de +10 a USD 10). Los valores del catálogo salen de `docs/producto.md`.
- **Features:** `menu`, `waiter_call`, `loyalty`, `analytics` por plan; `webar` por add-on vigente (solo Pro o Premium). En `grace` y `active`: todo lo contratado. En `read_only`: se apagan las interactivas (`waiter_call`, `webar`, `loyalty`) y quedan `menu` y `analytics`. En `suspended`: nada.
- **Límites en la base**, con *triggers* `BEFORE INSERT OR UPDATE`, bajo un *advisory lock* por organización para que dos pedidos simultáneos no superen el tope. Error: SQLSTATE `53400` (`configuration_limit_exceeded`) con mensaje `limit_exceeded:<recurso>`. Valen para todos los roles, `service_role` incluido: el tope es un invariante, no un permiso.
- **Escrituras bloqueadas por RLS** (`private.org_can_write`): se agrega a las políticas de escritura de `categories`, `products`, `branches` y `organizations`. `service_role` no pasa por RLS.
- **Carta pública suspendida:** las políticas públicas de `branches`, `categories` y `products` exigen `private.org_is_published` (estado ≠ `suspended`). La fila de `organizations` sigue visible (nombre y slug) y una función `public_menu_status(org, sucursal)` permite a la ruta distinguir «suspendida» de «no existe».
- **Superficie de API mínima:** dos funciones `SECURITY DEFINER` en `public`, con permisos explícitos, porque el servidor y la ruta pública las llaman: `org_entitlements(org)` (solo miembros; el Staff no ve plan ni fechas) y `public_menu_status(org, sucursal)` (anon). Todo lo demás en `private`. La prueba de ACL pasa de «no hay DEFINER en `public`» a una lista cerrada.
- **Lectura de suscripciones:** solo el `owner` de su organización (`subscriptions`, `subscription_addons`); `plans` y `addons` los lee cualquier usuario con sesión.

## Comportamiento y aceptación
- [x] **Estado:** dada una suscripción con fin `F`, el estado es `active` en `F`, `grace` hasta `F + 7 d` inclusive, `read_only` hasta `F + 15 d` inclusive y `suspended` después; un segundo más allá de cada borde cambia de estado. Sin suscripción es `suspended`. Registrar un nuevo `current_period_end` futuro restablece `active` en el siguiente pedido.
- [x] **Alta:** dada una organización nueva, su suscripción es `basic` con `trial_ends_at = created_at + 14 días` y estado `active`; las organizaciones del seed quedan `active`.
- [x] **Escrituras por estado:** en `active` y `grace`, owner y staff escriben categorías, platos y nombres; en `read_only` y `suspended`, `INSERT` da `42501` y `UPDATE`/`DELETE` afectan 0 filas (incluido desactivar un plato), pero siguen **leyendo** todo lo propio.
- [x] **Carta pública:** `active`, `grace` y `read_only` la muestran; `suspended` no devuelve sucursales, categorías ni platos, la ruta muestra «Carta temporalmente no disponible» y los datos siguen intactos en la base.
- [x] **Límites de platos activos:** Básico 80/81, Pro 200/201 y Premium sin tope: el plato 81 (201) activo es rechazado con `53400` tanto por un miembro como por el servidor; un plato inactivo se puede crear siempre; con el tope alcanzado, activar uno inactivo se rechaza y desactivar uno permite activar otro. Los topes se leen de `plans`: cambiar el valor en la tabla cambia el comportamiento sin tocar código.
- [x] **Downgrade:** al pasar de Pro a Básico con 150 platos activos, no se borra ni desactiva nada; editar o desactivar los existentes funciona; crear o activar más se rechaza hasta bajar de 80.
- [x] **Sucursales:** Básico 1, Pro 2, Premium sin tope; la segunda (tercera) sucursal se rechaza con `53400`. Queda lista la función de límite para mesas (`tables_per_branch`), que se aplicará cuando exista esa tabla.
- [x] **Concurrencia:** con 79 platos activos en Básico, cinco inserciones activas simultáneas dejan exactamente 80.
- [x] **Aislamiento:** los límites y el estado de una organización no afectan a otra; un usuario de A no puede leer la suscripción de B ni su `org_entitlements`; **un usuario ajeno que escribe en una organización al tope recibe `42501` sin ningún dato del tope** (ni límite ni uso).
- [x] **Carta suspendida y rutas inexistentes:** una sucursal que no existe (o es de otra organización) responde 404 aunque la organización esté suspendida.
- [x] **Features:** la matriz plan × add-on × estado devuelve el conjunto esperado (p. ej. Básico sin `waiter_call`; Pro con add-on en `read_only` sin `webar`; Básico con add-on sin `webar`; `suspended` vacío).
- [x] **Permisos:** el Staff no puede leer `subscriptions` ni ve el plan en `org_entitlements`; nadie escribe `plans`, `addons`, `subscriptions` ni `subscription_addons` por la API.
- [x] **ACL:** la prueba de catálogo cubre todas las funciones nuevas (propiedad, `search_path`, `EXECUTE`) y RLS en todas las tablas nuevas.
- [x] **Mutación:** apagar el *trigger* de límites, hacer que `org_can_write` devuelva siempre verdadero, correr un borde del estado un día, quitar `org_is_published` de las políticas públicas o dar `EXECUTE` de más hace fallar pruebas; restaurado, todo pasa.

## Alcance / fuera de alcance
- Incluye: migración (tablas `plans`, `addons`, `subscriptions`, `subscription_addons`; funciones; *triggers*; políticas), datos de catálogo, ajuste del seed (organización morosa para E2E), la ruta pública con el mensaje de suspendida, tipos regenerados, ADR 0006, pruebas (SQL de bordes, RLS, concurrencia, ACL, E2E).
- No incluye: `platform_admins`, `payments`, `audit_log`, pantallas de panel y aviso de mora al dueño, tabla de mesas (solo la función de límite), `price_history`, cobros.

## Dependencias y riesgos
- **Dinero y permisos (nivel C).** Un borde mal contado deja a un cliente escribiendo gratis o bloqueado de más: por eso los bordes se prueban a nivel de segundo y de día.
- **Rendimiento de las políticas públicas:** `org_is_published` se evalúa por fila; con cartas de cientos de platos es aceptable, pero se mide en «Rendimiento de la carta pública».
- **Reloj de la base:** el estado usa `now()` de Postgres; las pruebas fijan las fechas de la suscripción relativas a `now()` con márgenes de minutos.
- **Backfill:** a las organizaciones existentes se les da una prueba completa de 14 días desde la migración (no hay datos reales; en una base con clientes habría que decidir otra fecha).
- **`service_role` es todopoderoso:** puede dejar una suscripción incoherente. Mitigación: `CHECK` (al menos una fecha) y claves foráneas; la gestión real llega con «SuperAdmin» y su auditoría.
- Los topes dependen de que el trigger no se deshabilite: lo cubre la prueba de ACL/catálogo.

## Evidencias de verificación
Ejecutadas el 2026-10-14 sobre una base recién reseteada (`pnpm db:reset`), migración `20261014003848_plans_and_entitlements.sql`:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` 23/23 · `pnpm test:e2e` **16/16** (nuevos: carta suspendida a 390 px sin desborde y con `noindex`; 404 para slug de 65 caracteres y para sucursales inexistentes o ajenas en una organización suspendida).
- `pnpm test:rls`: **176/176** en 5 archivos: `catalog` (lectura pública, ahora también oculta lo de la organización suspendida), `tenancy`, `acl` (matriz cerrada de funciones y permisos), `billing` y `limits`.
- **Bordes del estado** (`billing.rls.test.ts`, función pura `private.billing_state` en SQL, al segundo): una hora antes y en el vencimiento → `active`; +1 s → `grace`; 7 días exactos → `grace`; 7 días + 1 s → `read_only`; 15 días exactos → `read_only`; 15 días + 1 s → `suspended`; sin fecha → `suspended`; resultado idéntico con otra zona horaria de sesión.
- **Por la API, días 0/1/7/8/15/16/40** (fin relativo a ahora con márgenes de 1 h): estado, escritura de owner y staff (categorías, precio, desactivar, renombrar sucursal y organización, borrar), lectura del personal y carta pública. Registrar un pago restablece todo en el siguiente pedido.
- **Límites**: Básico 80/81, Pro 200/201, Premium 251 sin tope, lote de 81 que falla entero, tope leído de `plans` (cambiarlo a 3 y a `null` cambia el comportamiento), downgrade Pro→Básico con 150 activos (no se pierde nada; editar y desactivar funcionan; crear y activar no; al bajar de 80 se vuelve a poder), aislamiento entre organizaciones, sucursales 1/2/sin tope, y **concurrencia** (79 activos + 10 altas o 10 activaciones simultáneas → exactamente 80).
- **Features** (matriz plan × add-on × estado, 10 casos) y permisos: el Staff no ve plan ni fechas; el owner sí; los de otra organización y `anon` no reciben nada; nadie escribe `plans`, `addons`, `subscriptions` ni `subscription_addons`; `anon` no lee ninguna de las cuatro tablas.
- **Mutaciones: 23 defensas rotas de a una, 22 detectadas** (la restante es equivalente, ver abajo). Fallan: trigger de platos apagado (10) · de sucursales (2) · `org_can_write` siempre verdadero (8) · gracia 7→8 días (11) · solo lectura 15→14 (3) · borde `at < fin` (1) · `has_feature` sin mora (3) · sin advisory lock (4) · activar sin consumir cupo (5) · `>` en vez de `>=` (8) · el staff lee suscripciones (1) · `EXECUTE` de `org_entitlements` a `anon` (2) · sin suscripción = activa (1) · alta sin trigger de prueba (57) · función `SECURITY DEFINER` nueva en `public` (1) · los miembros escriben `plans` (7) · el staff recibe plan (5) · escritura de categorías sin chequear la mora (6) · lectura pública sin `org_is_published` en `categories` (4), en `branches` (4) y en `categories` + `products` a la vez (6).
- **Mutación equivalente:** quitar `org_is_published` solo de la política pública de `products` no hace fallar nada, porque su `EXISTS` sobre `categories` ya aplica la política de `categories` (que sí lo exige). Es una defensa en profundidad redundante, no un hueco: con ambas quitadas se detecta. Se deja a propósito.
- **Revisión independiente (Codex, 2026-10-14): aprobar con cambios, dos defectos P2, ambos corregidos:**
  1. **Fuga de información por el trigger de límites.** Los triggers `BEFORE` corren antes del `WITH CHECK` de RLS y las funciones son `SECURITY DEFINER`: un usuario autenticado podía insertar un plato activo en una organización ajena al tope y recibir `53400` con `limit=… active=…` en el detalle. Corrección: si el pedido trae un usuario (`auth.uid()`) que no es miembro de la organización, el trigger no cuenta ni informa y deja que RLS rechace con `42501`; sin usuario (servidor) el tope se aplica siempre. Pruebas nuevas (6 casos): un usuario sin membresía y el owner de otra organización reciben `42501` sin ninguna pista (ni «limit», ni «active», ni `53400`), tampoco al insertar una sucursal ni al activar un plato ajeno (0 filas); el personal propio sí recibe el motivo; el servidor sigue sujeto al tope.
  2. **Sucursales inexistentes respondían 200 con la organización suspendida.** El respaldo consultaba solo la organización. Corrección: `public_menu_status(org, sucursal)` exige que la sucursal exista; ahora `resto-moroso/no-existe` y `resto-moroso/centro` (sucursal de otra organización) dan 404. Pruebas nuevas en RLS y 2 E2E.
  Se comprobó que ambas pruebas fallan con el defecto original reintroducido (2 y 1 fallas). La guarda del trigger de **sucursales** no se puede observar hoy por la API (`authenticated` no tiene permiso de `INSERT` en `branches`, así que el permiso falla antes que el trigger): es defensa en profundidad para cuando se conceda ese permiso.
- **Mutaciones en total: 26 defensas rotas, 24 detectadas y 2 equivalentes** (la política pública de `products` sin `org_is_published`, cubierta por la de `categories`; y la guarda del trigger de sucursales, cubierta por el permiso de `INSERT`).
- Revisión visual a 390 px de «Carta temporalmente no disponible» (cabecera de azulejos, texto claro, sin desborde).
- Sin residuos tras las corridas: 0 organizaciones `tt-*` y 0 usuarios `rls-*` en la base.

Pendientes:
- Revisión independiente con `agile-revisar` (nivel C: segundo agente, solo lectura).
- No probado: rendimiento de las políticas con `org_is_published` por fila con volumen real; Safari/iOS y dispositivos reales; lector de pantalla; login desde la app (no existe todavía); la zona horaria de la base distinta de UTC en producción (el cálculo usa horas y es independiente de la zona de sesión, verificado en SQL).

## Aprendizajes / cambios de decisión
- **Un trigger `SECURITY DEFINER` que cuenta o consulta antes de autorizar es un oráculo de información.** Postgres evalúa los triggers `BEFORE` antes del `WITH CHECK` de RLS, de modo que el error del trigger llega primero que el rechazo de la política. Regla para los próximos triggers de límite (mesas, modelos 3D): verificar pertenencia antes de contar y no poner datos del tope en el detalle del error de quien no es de la organización. Mi prueba anterior solo probaba al dueño propio; nadie probó el caso del tercero.
- **Un fallback no puede ignorar parte de la ruta:** si la consulta principal falla, el camino alternativo debe validar los mismos parámetros (acá, la sucursal), no solo parte de ellos.
- **El estado exacto por la API es difícil de clavar con el reloj real:** los bordes al segundo se prueban sobre la función pura (`billing_state(fin, instante)`), y por la API se usan márgenes de 1 h. Mantener la función pura e inmutable fue lo que lo hizo testeable.
- **«Día N» es techo de las 24 h transcurridas:** exactamente 7 días de atraso sigue siendo día 7 (gracia); un segundo más es el día 8. La ficha y `docs/producto.md` lo dicen explícito para evitar interpretaciones distintas.
- **Las políticas públicas necesitan `EXECUTE` para `anon`:** se evalúan con el rol que consulta, así que `org_is_published` obliga a dar `USAGE` sobre `private` a `anon`. Se limita a esa función y la prueba de ACL fija la matriz completa; cualquier función nueva debe declararse a propósito. Esto reemplaza la regla anterior «`anon` sin `USAGE` en `private`» del Núcleo (ADR 0006).
- **Los *triggers* `BEFORE` corren antes que los `CHECK`:** un `INSERT` con slug de 65 caracteres en una organización que ya está en el tope de sucursales falla por límite (`53400`), no por `23514`. Las pruebas del slug usan una organización propia sin sucursales.
- **Cambió la lectura pública de organizaciones:** la fila de una organización suspendida sigue siendo pública (nombre y slug), para poder mostrar el aviso; se ocultan sus sucursales, categorías y platos. El seed suma `resto-moroso` y la prueba de lectura pública lo espera.
- **Escrituras, no solo mesas:** la regla «mesas» quedó solo como función (`org_limit(org, 'tables_per_branch')`); su trigger se crea con «Mesas y QR».
- La ruta pública responde 200 con `noindex` para una cuenta suspendida (sin `cacheComponents` una página no fija 503); si se quisiera 503 habría que hacerlo en un handler o middleware.

## (C) Invariantes
1. El estado de mora se **deriva** de las fechas y de `now()`; nunca se guarda ni depende de un proceso programado.
2. En `read_only` y `suspended` no hay escritura de catálogo por la API, sin excepciones por rol.
3. Ninguna organización tiene más platos activos, sucursales o mesas que su plan permite *después de una operación nueva*; las existentes por encima del tope se conservan.
4. Pasar de activo a inactivo nunca se bloquea por límites.
5. Los datos de planes y suscripciones solo los escribe el servidor; el catálogo no vive en el código.
6. Ningún usuario ve la suscripción de otra organización; el Staff no ve plan ni facturación.
7. Una organización suspendida no publica su carta, pero no pierde datos.

## (C) Fallas y manejo de errores
- Tope alcanzado: la operación falla con `53400` y `limit_exceeded:<recurso>`; la aplicación lo traduce a un mensaje claro («Llegaste al límite de tu plan»).
- Escritura en solo lectura/suspendida: `INSERT` da `42501`; `UPDATE`/`DELETE` afectan 0 filas (la app debe mostrar el estado de la cuenta en vez de un error genérico, vía `org_entitlements.can_write`).
- Suscripción ausente o sin fechas: estado `suspended` (cerrado). El `CHECK` evita las fechas ausentes.
- Carrera entre dos activaciones: serializada por *advisory lock* de la organización; la segunda ve la cuenta ya actualizada.
- Reintentos: las operaciones son simples escrituras; reintentarlas no duplica nada salvo que la app genere filas nuevas.

## (C) Seguridad y permisos
| Dato / acción | anon | staff | owner |
| --- | --- | --- | --- |
| `plans`, `addons` | — | leer | leer |
| `subscriptions`, `subscription_addons` | — | — | leer la propia |
| `org_entitlements(org)` | nada | estado, `can_write`, features, límites y uso (sin plan ni fechas) | además plan, fechas y días de mora |
| `public_menu_status(org, sucursal)` | estado público de la carta (nulo si la sucursal no existe) | igual | igual |
| Escribir catálogo | — | solo `active`/`grace` | solo `active`/`grace` |
| Escribir planes y suscripciones | — | — | — (solo servidor) |

Amenazas: leer el estado de otra organización por `org_entitlements`, saltarse el tope con inserciones paralelas, activar platos para esquivar el tope, escribir durante la mora, hacer una función `SECURITY DEFINER` invocable de más, `search_path` secuestrado.

## (C) Migración y rollback
- Migración nueva, aditiva, más cambios en políticas existentes (se reemplazan por versiones con las nuevas condiciones). Nada destructivo; el backfill solo agrega filas. Solo local; **nada contra proyectos remotos** sin aprobación.
- Rollback: `git revert` de la migración + `pnpm db:reset`. En una base con datos: volver a crear las políticas anteriores (están en `20261014000121_*` y `20261013230544_*`), `drop trigger`/`drop function` de lo nuevo y `drop table` de las cuatro tablas nuevas; no se pierde dato de carta.

## (C) Aceptación explícita del riesgo
- El usuario fijó las reglas de negocio de mora, alta, límites y alcance el 2026-10-14 y pidió ejecutar el ítem con `agile-iterar`. Operación solo local y aditiva. La revisión de nivel C por un segundo agente (solo lectura) queda **pendiente**; no se integra a `main` hasta entonces.
