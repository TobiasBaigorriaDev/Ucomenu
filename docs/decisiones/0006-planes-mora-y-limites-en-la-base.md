# 0006 — Planes, mora y límites resueltos en la base

- Estado: aceptada
- Fecha: 2026-10-14

## Contexto
El producto vende tres planes más un add-on, con cobro manual en el MVP, una degradación progresiva por mora y topes de uso (sucursales, mesas, platos activos). Un error en estas reglas tiene costo directo: un cliente escribe sin pagar, o queda bloqueado de más. Las reglas deben valer para cualquier cliente de la base (panel, servidor, futuros jobs) y no depender de un proceso que pueda no correr.

## Decisión
1. **El estado de mora se deriva, no se guarda.** `private.billing_state(fin, instante)` es una función pura e inmutable: `active` hasta el fin, `grace` hasta +168 h, `read_only` hasta +360 h, `suspended` después. El fin es `greatest(current_period_end, trial_ends_at)`. Sin suscripción o sin fecha: `suspended` (falla cerrado). Registrar un pago es mover una fecha: el efecto es inmediato y no hay cron que pueda atrasarse.
2. **Escrituras bloqueadas por RLS** (`private.org_can_write`): solo `active` y `grace` escriben catálogo. Las políticas públicas de lectura exigen `private.org_is_published` (no `suspended`); el personal sigue leyendo lo suyo.
3. **Límites con triggers `BEFORE`**, sobre registros activos, al crear y al activar; activo → inactivo nunca se bloquea. Un *advisory lock* por organización y recurso serializa los pedidos paralelos. Error `53400` con mensaje `limit_exceeded:<recurso>`. Valen también para `service_role`: el tope es un invariante de datos, no un permiso.
4. **Catálogo en tablas** (`plans`, `addons`), nunca en el código; los topes nulos significan «sin límite».
5. **Superficie de API cerrada y enumerada.** Solo dos funciones `SECURITY DEFINER` en `public`: `org_entitlements(org)` (miembros; el Staff no recibe plan ni fechas) y `public_menu_status(slug)` (público: `available` | `suspended` | nulo, sin revelar la causa). Lo demás vive en `private`. La prueba de ACL declara la matriz completa de funciones y permisos: una función nueva rompe la prueba hasta que se la declare a propósito. `anon` recibe `USAGE` sobre `private` y `EXECUTE` solo de `org_is_published`, porque las políticas de lectura pública la evalúan con ese rol.
6. **Alta automática:** un trigger crea la suscripción de prueba (Básico, 14 días = 336 h) con cada organización nueva.

## Alternativas consideradas
- **Guardar el estado y actualizarlo con un job** — puede atrasarse o fallar; deja ventanas con el estado equivocado. Se descarta.
- **Validar los topes y la mora en el servidor de la aplicación** — se rompe con cualquier escritura que no pase por él. La base es la última línea.
- **Constraint o `CHECK` para los topes** — no puede contar filas de otras filas; el trigger con lock sí, y da un error propio.
- **Exponer más funciones en `public`** — cada una sería una API más a auditar; se prefiere `private` con la política como único consumidor.

## Consecuencias
- Cada recurso con tope nuevo (mesas, modelos 3D) necesita su trigger con `private.org_limit`; la función ya existe para `tables_per_branch` y `models_3d`.
- Toda tabla de escritura nueva debe incluir `private.org_can_write` en sus políticas.
- Las políticas públicas evalúan `org_is_published` por fila: medir con datos reales en «Rendimiento de la carta pública» y, si hace falta, cachear por organización.
- La ruta pública responde 200 con el aviso de cuenta suspendida y `noindex` (una página de Next no fija 503 sin `cacheComponents`).
- `service_role` puede dejar una suscripción incoherente; la auditoría llega con «SuperAdmin».
