# Cambio: gestión de sucursales en el panel del Dueño
Estado: implementado y verificado en local (2026-10-16), commiteado en `worktree-agent-a694228a3ab6a9f22`, sin integrar. **Activar/desactivar NO se hizo** (ver «Decisiones pendientes»)
Nivel: **C en rigor** (abre `INSERT` de `branches` a la API con una política nueva: toca autorización y, por el tope, dinero). Se mantuvo el diseño mínimo y conservador. Pendiente la revisión independiente que pide AGENTS.md (no se ejecutó Codex por consigna de esta tarea) y la aprobación humana de la política nueva.

## Objetivo
Hasta ahora las sucursales solo existían por script o por el alta del SuperAdmin. El Dueño ahora las lista, crea y renombra en `/panel/{slug}/sucursales`, con el tope del plan a la vista y la cuenta en pausa respetada.

## Hallazgos que cambiaron el alcance
- `branches` **no tiene `is_active`, dirección ni zona horaria** (solo `slug`, `name`, `created_at`, `waiter_call_cooldown_seconds`). La premisa «`slug` e `is_active` tienen restricciones por columna» (ADR 0005) vale para `organizations`; en sucursales hoy solo se actualiza `name` (y el cooldown, desde «Llamados»). Dirección y zona horaria no se inventaron (las coordenadas son del pase de fidelización, fase 3; las fechas usan Buenos Aires fijo).
- Tampoco hay `DELETE` de sucursales. El tope del plan **cuenta todas** las sucursales (`private.enforce_branch_limit`), no las activas: `docs/producto.md` dice «misma regla para sucursales y mesas», pero el código hoy no la cumple. No se tocó (consigna: no cambiar límites).
- El alta no existía para la API: `branches` solo tenía `SELECT` y `UPDATE (name, waiter_call_cooldown_seconds)`.

## Decisiones
1. **Solo el Dueño.** Página y acciones con `requireOwner` (el Staff vuelve al Resumen; el enlace «Sucursales» del menú es solo del Dueño, como Suscripción y Personal). La base lo impone aparte: política de `INSERT` y de `UPDATE` con `private.is_org_owner`.
2. **Alta por la API con el cliente de la persona (RLS), sin función `SECURITY DEFINER` ni `service_role`:** migración `20261018100000_gestion_de_sucursales.sql` = política `INSERT` (`is_org_owner` y `org_can_write`) + `GRANT INSERT (organization_id, slug, name)` + `CHECK (char_length(name) <= 80) NOT VALID` (porque la API ahora escribe el nombre; no revisa filas viejas). Se eligió esto frente a una función porque el patrón de las demás pantallas (mesas, carta) es política + permisos por columna, no agrega superficie en `public` y el tope y la mora ya viven en trigger y política.
3. **El tope del plan no se duplica:** lo aplica `branches_enforce_limit` (BEFORE INSERT, ADR 0006, con *advisory lock*). La pantalla muestra «Sucursales: X de N» (de `org_entitlements`), oculta el alta al llegar al tope y explica («Tu plan incluye N sucursales y ya las usás. Para sumar otra, contactá a UcoMenu para cambiar de plan»); si el cupo se ocupa con la pantalla abierta, la base rechaza (`53400`) y la acción muestra el mismo mensaje con el número que sale de `org_entitlements`, nunca del texto del error.
4. **`slug` se elige al crear y nunca cambia** (sigue sin `UPDATE`; está en `/m/{local}/{sucursal}`). El formulario lo propone a partir del nombre (sin acentos, minúsculas, guiones) mientras no se edite, lo valida con el mismo contrato que la base (el valor mal formado se rechaza, no se «arregla») y avisa que no se podrá cambiar.
5. **Renombrar** ya era del Dueño (`UPDATE (name)`); sigue permitido con el tope alcanzado. Sin falsos éxitos: toda escritura pide las filas de vuelta y distingue «no existe en este local» de «no permitido» leyendo.
6. **Cuenta en pausa:** en solo lectura y suspendida la lista se ve, los controles se deshabilitan con el aviso fijo y una acción forzada responde con el motivo sin guardar (la base también la rechaza con `42501`). En gracia se edita con normalidad.
7. **Staff con cupo agotado, directo por la API:** el trigger del tope corre antes de la política, así que recibe `53400` en vez de `42501` (mismo patrón y misma filtración mínima que mesas y platos; la pantalla ni siquiera le ofrece el formulario).
8. **Multi-sucursal en el resto del panel (revisado, sin rediseñar):** Mesas y Llamados ya se agrupan por sucursal (con prueba); la Sala en vivo muestra el nombre de la sucursal en cada llamado cuando hay más de una; el Historial de precios es de la organización. El Resumen sumó un solo cambio mínimo: sin sucursales, el Dueño ve «Crear la primera sucursal».

## Aceptación
- [x] El Dueño crea una sucursal (nombre + identificador propuesto del nombre) y aparece en la lista con su dirección de carta y sus mesas activas; `/m/{local}/{sucursal}` responde 200.
- [x] Identificador inválido, repetido en el local, nombre en blanco o de más de 80: error claro, lo escrito se conserva y no se guarda nada; la base valida por sí sola (incluido el tope de 80).
- [x] Renombrar persiste y el identificador no cambia; nadie cambia `slug`, `organization_id` ni `id`, ni borra.
- [x] Tope: Básico 1 de 1 y Pro 2 de 2 muestran el aviso y ocultan el alta; Premium «sin tope»; con cupo ocupado a mitad de camino la base rechaza y la pantalla lo explica; 4 altas paralelas con un cupo libre: entra una.
- [x] Staff: sin enlace, la URL lo devuelve al panel, sus escrituras directas no entran. Un Dueño de un local que es Personal de otro no escribe en el segundo.
- [x] Solo lectura y suspendida: aviso, controles deshabilitados, acción forzada sin éxito falso; gracia edita.
- [x] 390 px sin desborde y botones ≥ 44 px, con nombre y dirección largos.
- [x] Sin sesión: login y vuelta a la pantalla.

## Fuera de alcance
- **Activar/desactivar y borrar sucursales**, dirección y zona horaria (ver pendientes). Cambiar de plan (lo hace UcoMenu a mano). Personal por sucursal. Orden manual de sucursales.

## Decisiones de producto (delegadas por el usuario, 2026-10-16)
1. **Desactivar una sucursal: fuera de este incremento** (ítem C aparte en el tablero). Regla fijada para cuando se haga: una sucursal inactiva **no cuenta** para el tope (misma regla que platos y mesas, `docs/producto.md`); su carta pública y los QR de sus mesas muestran «no disponible» (no 404, para que un QR impreso no parezca roto); no admite llamados nuevos y sale de la Sala; reactivar respeta el tope. Implica `is_active`, reemplazar `public_menu_status`, `resolve_table_qr`, `create_waiter_call` y `enforce_branch_limit` y el conteo de `org_entitlements`. Mientras tanto, un identificador mal escrito o una sucursal de más se resuelven pidiéndolo a UcoMenu; el formulario lo advierte antes de crear.
2. **Corrección del identificador:** el Dueño no lo cambia (rompería los links públicos; los QR no dependen de él). Lo corrige UcoMenu por SQL; más adelante, herramienta de SuperAdmin con redirección.
3. **Dirección y zona horaria: no se agregan ahora.** Dirección y coordenadas llegan con la Fase 3 (geofencing); la zona horaria, cuando haya un cliente fuera de Argentina (hoy, Buenos Aires fijo).

## Pendiente para quien integra
1. **Aprobación humana** de la política `INSERT` sobre `branches` (C: autorización y tope del plan). La delegación de las decisiones de arriba no la reemplaza.
2. **Guía de primeros pasos** (`alta-guiada-del-dueno.md`, pendiente 2): con varias sucursales suma todas (basta que una tenga mesas); no se rediseñó. La «Sala en vivo» y el Staff no se filtran por sucursal (el personal es por local).

## Evidencia (2026-10-16, instancia Supabase aislada `ucomenu-sucursales`, puertos 56xxx; la base compartida no se tocó)
`pnpm lint` y `pnpm typecheck` limpios · `pnpm test` 347/347 (10 nuevas en `src/lib/sucursales/sucursales.test.ts`) · `pnpm build` · `pnpm test:rls` completo **514/514** tras `db reset` con la migración nueva (12 nuevas en `tests/rls/sucursales.rls.test.ts`; `acl` suma el control de las columnas de `INSERT` de `branches`; `tenancy` cambia una prueba: el alta de sucursales ya no es «nadie», ver abajo) · `pnpm exec playwright test` completo **216/216** (15 nuevas en `e2e/sucursales.spec.ts`, a 390 px) · `database.types.ts` idéntico al generado (el esquema no cambia de columnas).
Una primera corrida de la spec nueva falló en bloque (15/15, también en el login) justo después de un `pnpm build`; repetida pasó 15/15 y no se reprodujo (compatible con un servidor de pruebas que arrancó sobre un build a medio escribir). Una corrida de RLS tras las mutaciones de base dio rojo y la repetición, verde (restos de la mutación 7; la limpieza previa de `global-setup` los borra).
Mutaciones (una a la vez, restauradas y verificadas): **base** 6 detectadas (política para cualquier miembro, sin `org_can_write`, sin el tope de 80, `GRANT INSERT (id)`, trigger del tope apagado, `GRANT UPDATE (slug)`) más una política abierta a `anon` que también se detecta; **aplicación** 8 detectadas (acción sin `requireOwner`, página sin `requireOwner`, enlace del menú para todos, renombrar sin acotar por local —solo lo detecta un Dueño de dos locales, prueba agregada a raíz de esta mutación—, el tope nunca detectado en pantalla, identificador sin validar, nombre sin recortar y aviso de solo lectura ausente). Equivalente: quitar la comprobación previa de cuenta (`guard`) del módulo, porque la política la repite y el error se traduce igual.
Revisión visual a 390 px con capturas (lista con alta, tope alcanzado con el aviso persistente, cuenta en solo lectura): sin desborde; el menú de pestañas ya hacía scroll horizontal y «Sucursales» queda parcialmente visible hasta deslizar (igual que Suscripción y Personal).
**No ejecutado:** revisión independiente (Codex) ni teléfono real.

### Prueba existente modificada
`tests/rls/tenancy.rls.test.ts` («nadie crea ni borra organizaciones o sucursales por la API») afirmaba que nadie crea sucursales. Ahora separa: organizaciones y borrados siguen en `42501`; el alta de sucursal en Café Ejemplo (Básico, ya con una) da `53400` al Dueño y al Staff (el tope del plan corre antes que la política) y `42501` a quien no es miembro, sin crear nada.

## (C) Invariantes
- Solo el owner de una organización crea sucursales en ella, y solo con la cuenta al día (activa o gracia); nunca por `anon`.
- Nadie fija `id`, `created_at` ni el cooldown al crear; `slug` y `organization_id` no cambian después; nadie borra.
- El tope del plan rige para toda alta (API y `service_role`), con *advisory lock*; ninguna escritura bloqueada queda guardada ni informada como éxito.

## (C) Fallos y recuperación
- Si la migración falla, no queda nada a medias (una sola transacción). Rollback documentado en la migración: quitar la política, revocar el `INSERT` y el `CHECK`; el alta vuelve a ser solo del servidor.
- Una sucursal creada por error no se puede borrar ni renombrar su identificador desde el panel: queda a cargo de UcoMenu (SQL). Es el costo de no abrir `DELETE`.
- Alta repetida (doble clic): la segunda falla por `unique (organization_id, slug)`.

## (C) Revisión y aprobación
- **Ronda 1 (Codex, commit `de1bfce`):** APROBAR CON CAMBIOS. Un hallazgo, real y corregido: `loadSucursales` leía sucursales y mesas sin paginar y PostgREST corta en `max_rows = 1000`, así que con más de 1000 mesas (Premium no tiene tope) los conteos salían bajos. Corrección: `readAllPages` (`src/lib/sucursales/paginar.ts`) pide página por página; prueba de regresión `paginar.test.ts` (falla si el ayudante lee una sola página). E2E de sucursales 15/15 tras el cambio. La política, el `GRANT` y el orden trigger-antes-que-RLS no recibieron objeciones.
- **Ronda 2 (verificación, commit `42edb7d`):** APROBAR, sin hallazgos nuevos. **Aprobación humana de la política `INSERT` sobre `branches`: dada por el usuario el 2026-10-16.** Integrado a `main` en `f8461ab`; falta aplicar la migración en staging/producción.
