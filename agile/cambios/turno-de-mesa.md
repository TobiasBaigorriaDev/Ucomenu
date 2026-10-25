# Cambio: Turno de mesa que rota al cobrar (primera mitad de la cuenta del comensal)
Estado: **implementado en local y aprobado por la revisión independiente (Codex, 2 rondas); desplegado en staging (Fly v50, migración aplicada el 2026-10-25); falta probarlo con sesión real** (aprobada por el usuario el 2026-10-24; evidencia al final). Decisiones en el [ADR 0044](../../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md). Segunda mitad: [cuenta del comensal](cuenta-del-comensal.md).
Nivel: **C** — toca `close_order`/`void_order` (el camino del cobro) y es la defensa de la que depende la exposición de información de la mitad siguiente. Revisión independiente (Codex) y aprobación del usuario antes de aplicar la migración en staging.

## Objetivo
Que cobrar la mesa «renueve» el QR **sin cambiar el QR impreso**: al cerrar o anular el pedido, o al apretar «Reiniciar QR de la mesa», todo ticket de visita anterior queda sin acceso a lo que dependa del turno, y quien escanee después arranca limpio.

## Decisiones (particulares)
1. **Esquema:** `tables.turn_started_at timestamptz not null default now()`. Las mesas existentes arrancan con su fecha de creación del turno = la de la migración (sin datos que mover).
2. **Rotación dentro de la función** (`private.end_table_turn`, que también da por **vencido el «Pedir la cuenta» pendiente** de la mesa: era de quienes ya se fueron y, pendiente, taparía con «ya pedida» el de la mesa nueva; el «Llamar al mozo» no se toca): `close_order` y `void_order` ponen `turn_started_at = clock_timestamp()` en la mesa del pedido (si tiene `table_id`) en la **misma transacción**, después del `for update` del pedido y solo cuando el estado cambia (repetir devuelve `unchanged` y no rota). Una mesa borrada (`table_id` nulo) no rota nada.
3. **`reset_table_turn(p_table uuid)`** (nueva, `authenticated`): cualquier miembro de la organización de la mesa; nunca depende de plan ni de mora; mesa inexistente o ajena = `table_not_found` indistinguible. Rota igual (y vence el pedido de cuenta pendiente) y devuelve `{table_id, turn_started_at}`.
4. **Lectura:** `private.ticket_in_turn(p_table, p_ticket_at)` = `p_ticket_at > turn_started_at` (estricto: un ticket de la misma emisión que la rotación no vale). Se usa en la mitad siguiente; acá solo se crea y se prueba.
5. **Sala:** botón «Reiniciar QR de la mesa» en la pantalla de la mesa, con confirmación («Quienes tengan la cuenta abierta en el celular tendrán que escanear de nuevo») y aviso del resultado. Sin cambios en el QR, en su token ni en su descarga.
6. **Lo que no cambia:** la regla de los 10 minutos tras atender la cuenta (`session_closed`) y el vencimiento del ticket a las 3 h siguen igual y conviven con esto.

## Invariantes
- `turn_started_at` solo lo escriben `close_order`, `void_order` y `reset_table_turn` (y el default). Ningún rol de la API tiene `UPDATE` sobre esa columna (revisar los permisos de columna de `tables`).
- Rotar nunca puede bloquear ni demorar un cierre: sin mora, plan ni permisos extra.
- Cerrar dos veces o anular dos veces rota **una** vez.
- El QR (`qr_token`) no cambia con ninguna de estas acciones.

## Fallos y recuperación
- Si la rotación falla dentro de `close_order`, falla el cierre completo (transacción): el mozo reintenta; no queda un pedido cerrado con turno vigente.
- Orden de bloqueos: **mesa → pedido**, el mismo que usa borrar una mesa (la clave foránea `on delete set null (table_id)`). El orden contrario producía un deadlock (hallazgo 2 de la revisión). La autorización se vuelve a comprobar después de ambas esperas y antes de escribir (hallazgo 1).
- Rollback: `git revert` + `pnpm db:reset`; con datos, volver a crear `close_order`/`void_order` de `20261128100000`, borrar `reset_table_turn` y `drop column turn_started_at`.

## Aceptación
- [x] Cerrar un pedido de una mesa mueve `turn_started_at`; cerrarlo otra vez no lo mueve.
- [x] Anular un pedido lo mueve; un pedido sin mesa (mesa borrada) no falla ni rota nada.
- [x] `reset_table_turn`: Dueño y Staff pueden; otra organización, anónimo y mesa inexistente no (mismo error); no depende de mora ni plan.
- [x] Ningún rol de la API puede escribir `turn_started_at` directo (ni `anon` ni `authenticated`).
- [x] `ticket_in_turn`: ticket anterior = falso; igual a la rotación = falso; posterior = verdadero.
- [x] En la Sala, «Reiniciar QR de la mesa» pide confirmación, rota y avisa; a 390 px sin desborde.
- [x] El `qr_token` y la ruta `/t/{token}` no cambian.
- [x] Cerrar, anular o reiniciar vence el «Pedir la cuenta» pendiente de ESA mesa y no toca el «Llamar al mozo» ni otras mesas; un cierre repetido o fallido no toca los llamados.

## Pruebas previstas
RLS (con `docker exec` donde haga falta): rotación por cierre/anulación/reinicio, idempotencia, permisos y ajeno. Unitarias del cliente de la acción. E2E de la pantalla de la mesa a 390 px. Mutaciones sobre: rotar al repetir el cierre, `ticket_in_turn` no estricto, reinicio sin comprobar la organización.

## Fuera de alcance
Cambiar el diseño del QR, regenerar el token, mostrar la cuenta al comensal (mitad siguiente), reinicio masivo de todas las mesas.

## Evidencia
Base local reseteada con la migración nueva, 2026-10-24, sobre `9168c30` + el diff de este cambio (commit indicado en Git):
- `tests/rls/turno-de-mesa.rls.test.ts` (nuevo) **13/13**: cerrar y anular mueven solo el turno de esa mesa y repetir no; un cierre fallido no lo mueve; mesa borrada; plan dado de baja y cuenta vencida; reinicio de Dueño y Staff sin tocar el `qr_token`; otra organización, inexistente, no uuid y `anon`; nadie de la API escribe `turn_started_at`; `ticket_in_turn` (anterior, igual, posterior, nulo, mesa inexistente, y un ticket que valía deja de valer al cerrar).
- `tests/rls/acl.rls.test.ts`: suma `reset_table_turn` y `private.ticket_in_turn` a la lista de permisos.
- **`pnpm test:rls` completo: 64/64 archivos, 1399/1399 pruebas** (1833 s).
- `src/lib/sala/turno.test.ts` (nuevo) **4/4**. `pnpm test`: 1051/1052; falla solo `textos.test.ts` («Menufeed»), la falla ajena ya registrada.
- `e2e/sala-turno.spec.ts` (nuevo) **2/2** a 390 px (confirmación, cerrar sin reiniciar no cambia nada, el reinicio mueve solo esa mesa y deja el token, mesa de otro local = 404), con `sala-operar` y `sala-anotar`: 14/14 con 3 trabajadores. `pnpm typecheck` y `pnpm lint`: limpios; `pnpm build` correcto.
- **Mutaciones** (función cambiada en la base local; restaurada con `pnpm db:reset`): `ticket_in_turn` con `>=` → falla 1 prueba; `reset_table_turn` sin comprobar la organización → falla 1. Ambas detectadas.
- **No corrido:** revisión independiente, aplicar en staging, teléfono real, mutación de «repetir el cierre mueve el turno» (la defensa es un `return` anterior al UPDATE y la prueba lo cubre con dos cierres seguidos).

## Revisión y aprobación
- **Ronda 1 — Codex, solo lectura, nivel C, sobre `e9de69d`: APROBAR CON CAMBIOS, 2 hallazgos importantes, ambos reales** (los reproduje con una prueba que fallaba antes de corregir):
  1. *Autorización sin revalidar tras esperar la mesa*: `reset_table_turn` comprobaba la membresía antes del `UPDATE` y `close_order`/`void_order` sumaban la espera de la mesa después de su última comprobación. Corregido: se toma el candado de la mesa y se vuelve a comprobar antes de escribir.
  2. *Deadlock entre cierre y borrado de mesa*: el cierre bloqueaba pedido → mesa y borrar una mesa bloquea mesa → pedido (FK `on delete set null`). Corregido: el cierre y la anulación toman primero la mesa (`for no key update`, que no choca con los `for key share` de las claves foráneas) y después el pedido. Si la mesa se borró mientras esperaban, el pedido ya quedó sin `table_id` y se cierra igual.
- Pruebas de regresión nuevas en `turno-de-mesa.rls.test.ts` (**15/15**): una con membresía revocada mientras esperan la mesa (reiniciar, cerrar y anular) y otra con un cierre que compite con un `DELETE` de la mesa (sin `deadlock`, el cierre se completa y el pedido queda `closed` sin mesa). **Fallaban con el código anterior** (`table_not_found` esperado y no devuelto; `ERROR: deadlock detected`) y pasan con la corrección. `acl` + `turno-de-mesa` 37/37; `pedidos`, `mesas`, `sala-*`, `borrado-de-organizaciones` y `purga-de-pedidos` 152/152.
- **Ronda 2 — verificación de Codex sobre `4b65ab1`: APROBAR.** Sin hallazgos nuevos ni regresiones; los dos hallazgos previos, corregidos. No ejecutó pruebas (las corridas son las de arriba).
- **Aprobación del usuario para aplicar la migración en staging: dada el 2026-10-25**, junto con la de la cuenta del comensal. La migración se corrigió en su mismo archivo porque nunca se aplicó fuera de local.

## Cambio posterior (hallazgo de la revisión de la cuenta del comensal, ronda 1)
La [revisión de Codex de la cuenta del comensal](cuenta-del-comensal.md#revisión-y-aprobación) encontró que un «Pedir la cuenta» pendiente del turno anterior tapaba el de la mesa nueva. Se corrigió **en esta misma migración** (nunca se aplicó fuera de local) con `private.end_table_turn` y se agregó la prueba (`turno-de-mesa.rls.test.ts` **17/17**; fallaba antes de corregir y cae con la mutación «sin vencer el pedido de cuenta»). Efecto visible para el mozo: la tarjeta «Pide la cuenta» de una mesa que acaba de cobrar sale sola de la Sala. Ronda de verificación de Codex de este cambio: ver la ficha de la cuenta del comensal.
Además, `private.end_table_turn` toma el candado asesor por mesa de `create_waiter_call` (carrera con un «Pedir la cuenta» sin confirmar, ronda 2) y la migración de la cuenta del comensal reemplaza `create_waiter_call` para que el cooldown sea del turno. Prueba: `turno-de-mesa.rls.test.ts` **18/18**.
Ronda 3: `end_table_turn(p_table, p_org)` revalida la membresía tras esperar el candado de los llamados y el cooldown lee el turno después de ese candado. Prueba: `turno-de-mesa.rls.test.ts` **20/20**.
- Despliegue en staging junto con la [cuenta del comensal](cuenta-del-comensal.md#evidencia): ver ahí.

## Cambio posterior: los llamados también terminan con el turno (feedback del usuario en staging, 2026-10-25)
Probando en staging con un mismo teléfono, el usuario vio que **«Reiniciar QR de la mesa» no cortaba los llamados**: el cliente seguía pudiendo llamar al mozo. Era un hueco del diseño original (el turno solo gobernaba la cuenta; los llamados dependían del ticket de 3 h y de la cuenta atendida). Corregido en la migración `20261202100000_llamados_del_turno.sql` (nueva: la anterior ya estaba en staging): `create_waiter_call` responde `session_closed` si `turn_started_at` es posterior a la emisión del ticket (`v_visit + 1 s <= turno`; misma tolerancia de 1 s que el cierre por cuenta atendida, sin los 10 minutos de gracia). Sin ticket (llamar directo a la API) no se compara. Vale para cerrar, anular y reiniciar. [ADR 0044, enmienda](../../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md).
- Pruebas: `turno-de-mesa.rls.test.ts` **24/24** (cuatro nuevas, escritas antes y fallando con el código anterior: reinicio, cobro y anulación, tolerancia de 1 s y la mesa vecina no afectada); E2E `cuenta-del-comensal.spec.ts` (reiniciar y cobrar: el celular no puede llamar hasta escanear de nuevo, y escaneando de nuevo sí).
- Efecto para el comensal: tras cobrar, quien siga en la mesa y quiera llamar tiene que escanear de nuevo.
- Las pruebas viejas que fabrican tickets «de hace X» sobre mesas recién creadas (`waiter-calls`, `sala-module`, `ticket-de-visita`) suponían una mesa que nace después de su propio ticket; ahora sus mesas nacen con un turno de hace días (no cambia lo que prueban).
- Pruebas de carrera de este archivo: pasaron a esperas activas (hasta que la otra sesión duerme y la llamada queda bloqueada) en vez de tiempos fijos, que daban falsos fallos con 14 archivos en paralelo.
- **Revisión de este cambio — Codex, solo lectura, nivel C, sobre `63fd7a5`: APROBAR, sin hallazgos funcionales.** Una sugerencia, válida y ya corregida en `90ce1ab`: la ficha decía 28/28 y el archivo tiene 24 pruebas. Confirma que la corrección de los llamados conserva la tolerancia de 1 s y que la prueba de contraste de la cuenta es sensible a la falla (sin ejecución visual propia).
- **Despliegue de la corrección en staging (2026-10-25, aprobado por el usuario):** `supabase db push` sobre `ucomenu-staging`: el `--dry-run` listó solo `20261202100000`, la aplicó, y un nuevo dry-run da «Remote database is up to date». `flyctl deploy -c fly.staging.toml --local-only --depot=false` con los cuatro argumentos públicos, desde `b4ce62a`; **Fly v51** (`started`, control `1 passing`). Con la clave pública: `get_table_account`, `reset_table_turn`, `create_waiter_call`, `orders` y `order_items` → `42501`. HTTP sin sesión: `/login`, las dos cartas de demo y `/privacidad` **200**; `/t/<token inexistente>` **404**; `/sala/la-bestia` y `/sala/la-bestia/mesas` **307**. Los commits no se subieron a `origin/main`. Sin secretos tocados. **Falta que el usuario lo pruebe en el teléfono:** reiniciar el QR y no poder llamar hasta escanear de nuevo; la cuenta con una paleta oscura.
- **Suite RLS completa final (sobre `90ce1ab`, log completo `--reporter=verbose`): 1370 pasaron y 1 falló, más 3 archivos que no llegaron a correr.** Identificados: `owner-lectura` («acción de auditoría fuera de la lista blanca», SQL de preparación sobre `audit_log`) es la intermitente conocida; y **3 *workers* se cayeron con `0xC0000409`** (`promociones`, `videos-mux`, `sucursal-adicional`: el fallo ajeno que `AGENTS.md` manda repetir una vez), por eso el resumen decía 61 + 1 de 65 archivos y faltaban 53 pruebas. Repetidos solos: `promociones` **68/68**, `videos-mux` **35/35**, `sucursal-adicional` **23/23** y `owner-lectura` **13/13**.
- E2E de este cambio: `cuenta-del-comensal`, `sala-turno`, `llamados`, `ticket-de-visita`, `llamado-config`, `sala-mesas`, `sala-operar` y `sala`: **91/93** con 2 trabajadores; las dos fallas eran de `ticket-de-visita` (mesas recién creadas con tickets «de hace X») y quedaron corregidas (`ticket-de-visita` + `llamados` **28/28**).

## Cambio posterior 2: recargar no devuelve los botones (feedback del usuario, 2026-10-25)
Con los llamados cortados por el turno, el usuario preguntó si se podía evitar que **al recargar la página** volvieran los botones: recargar emitía un ticket nuevo (con un QR estático una recarga es indistinguible de un escaneo; límite aceptado del ADR 0010). **Se resuelve con una dirección por visita** ([ADR 0044, enmienda 2](../../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md)): escanear emite el ticket y redirige a `/t/{token}?v={ticket}`; recargar lo reutiliza (y el plazo de 3 h tampoco se renueva); si el turno empezó después, la barra arranca en «Esta sesión venció. Escaneá de nuevo» sin botones.
- Nivel **M** (la autoridad no cambia: `create_waiter_call` rechaza igual; es solo la entrada pública y una función de solo lectura que devuelve un booleano), **sin revisión independiente** por defecto.
- Base: migración `20261203100000_visita_en_turno.sql` (`visit_in_turn`, solo `service_role`, misma regla y tolerancia de 1 s que el corte de llamados). Aplicación: `src/lib/llamados/visita.ts` (leer `v`, armar URLs), `visit-turn.ts` (falla abierto), las páginas `/t/{token}` y `/t/{token}/videos` (redirigen al escanear y se pasan la visita en los enlaces), `CallBar` (`expired`).
- Decisiones: la página falla **abierta** si `visit_in_turn` falla (la acción vuelve a comprobar); una `v` forjada, de otra mesa, del futuro o vencida **no** emite un ticket nuevo (pide escanear de nuevo); sin `v` es un escaneo; `lang` se conserva en la redirección.
- **Límite que queda:** quien escribe la URL a mano sin `v` recibe una visita nueva (no se puede distinguir de un escaneo).
- Pruebas: `turno-de-mesa.rls.test.ts` **27/27** (tres nuevas de `visit_in_turn`: regla y tolerancia, coincide con `create_waiter_call`, solo `service_role`); `visita.test.ts` **9/9**; E2E `ticket-de-visita.spec.ts` (reemplaza «recargar emite un ticket nuevo»; escanear redirige conservando `lang`, recargar reutiliza la visita, `v` inválida, y tras reiniciar o cobrar recargar pide escanear de nuevo y re-escanear permite llamar; el feed recibe la visita): `ticket-de-visita` + `feed-videos` **28/28**. `acl` suma `visit_in_turn`.
