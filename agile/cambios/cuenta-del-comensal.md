# Cambio: El comensal ve su precuenta al pedir la cuenta
Estado: **implementado en local; falta la revisión independiente y la aprobación para staging** (aprobada por el usuario el 2026-10-24; depende de [turno de mesa](turno-de-mesa.md), aprobado por Codex). Evidencia al final. Decisiones en el [ADR 0044](../../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md).
Nivel: **C** — exposición de información a anónimos (consumo de una mesa). Revisión independiente y aprobación del usuario antes de aplicar la migración en staging.

## Objetivo
Que quien toca «Pedir la cuenta» en `/t/{token}` vea en su celular qué se consumió y cuánto va, con «No válida como factura», sin que ningún anónimo gane permiso de lectura sobre los pedidos.

## Decisiones (particulares)
1. **Función `get_table_account(p_token text, p_ticket_at timestamptz)`**, `SECURITY DEFINER`, `search_path` vacío, ejecutable **solo por `service_role`** (ADR 0038). Resuelve el token como `resolve_table_qr`; devuelve `not_found` indistinto para token desconocido, mesa, sucursal u organización inactivas, o plan sin la función de llamado (la misma condición que ofrece los botones; los pedidos del mozo no se exigen: la cuenta ya anotada se puede ver).
2. **Condiciones para devolver datos** (todas): ticket del turno (`private.ticket_in_turn`), existe un llamado `bill` de la mesa creado dentro del turno (pendiente o atendido) y hay un pedido `open` de la mesa. Si falta el pedido: `{status:'empty'}`; si falta el llamado o el turno: `{status:'unavailable'}` (la app lo muestra como «escaneá de nuevo»).
3. **Contenido:** por línea no cancelada, nombre, opciones, cantidad, importe por línea (`cantidad × (efectivo + opciones)`, lo copiado al anotar), total, cantidad de platos, nombre del local, etiqueta de mesa y hora de la sucursal. **Nunca** observaciones, motivos, personas, ids ni líneas canceladas.
4. **Acción de servidor** en `/t/[token]`: verifica el ticket (HMAC) y llama con `createAdminClient()`. **Sin límite propio por conexión** (decisión al implementar): sin ticket válido no se llega a la base y cada lectura es de un solo pedido; si apareciera abuso, se suma con la clave de conexión de los llamados.
5. **UI:** tras «Pedir la cuenta» (creada, ya pedida o en espera del cooldown: los tres implican un pedido de cuenta reciente) aparece «Ver mi cuenta» en la barra de la mesa; se abre una hoja con la precuenta, el total y la leyenda; se vuelve a leer al abrirla (no se cachea). Textos en los tres idiomas. A 390 px, sin desborde. Ticket vencido o turno rotado: mismo aviso «Esta sesión venció. Escaneá de nuevo el QR».
6. **Sin** cobro, propina, división, impresión del lado del comensal ni cambio de estado del pedido.

## Invariantes
- `anon` y `authenticated` siguen sin permiso sobre `orders` y `order_items`; la función no se concede a ellos.
- Sin llamado de cuenta en el turno o con el ticket anterior al turno, la respuesta no contiene ni un importe.
- Un pedido cerrado o anulado no se muestra (el turno ya rotó).
- La respuesta de `unavailable` no distingue entre sus causas.

## Riesgo aceptado (usuario, 2026-10-24)
Quien escanee el QR durante el turno puede ver el consumo de esa mesa después de que se pidió la cuenta. Ver «Consecuencias» del ADR.

## Fallos y recuperación
Si la lectura falla, la hoja dice «No pudimos mostrar tu cuenta; pedísela al mozo» y la barra sigue funcionando. Rollback: `git revert` + `pnpm db:reset`; con datos, `drop function public.get_table_account`.

## Aceptación
- [x] Sin «Pedir la cuenta» en el turno no se devuelve ningún dato; con ticket anterior al turno tampoco.
- [x] Tras pedirla: platos vigentes, opciones, importes, total y leyenda; sin observaciones ni canceladas.
- [x] Pedido cerrado, anulado, mesa inactiva, token ajeno o malformado: mismo `unavailable`/`not_found`, sin pistas.
- [x] `anon`/`authenticated` no pueden ejecutar la función ni leer `orders`.
- [x] Reiniciar el QR o cerrar la mesa corta el acceso del ticket anterior (E2E: el celular del comensal y la sesión del mozo).
- [x] 390 px sin desborde; ticket vencido muestra el aviso de siempre.
- [ ] Los tres idiomas se ven bien en pantalla: los textos existen en español, inglés y portugués (los exige el tipo `Textos`), pero **no hay E2E en inglés ni portugués**; falta mirarlos en el teléfono.

## Pruebas previstas
RLS/permisos con el rol de servicio y sin él; unitarias de la forma de la respuesta y del recorte de campos; E2E de punta a punta (pedir la cuenta → ver → cobrar → reescaneo). Mutaciones: saltarse la condición del llamado, `ticket_in_turn` no estricto, incluir observaciones.

## Fuera de alcance
Pago desde el celular, propinas, división de cuenta, factura, historial del comensal, identificar a la persona (ADR 0042).

## Evidencia
Base local reseteada con las dos migraciones (`20261130100000`, `20261201100000`), 2026-10-24/25, sobre `4218d9c` + el diff de este cambio (commit indicado en Git):
- `tests/rls/cuenta-del-comensal.rls.test.ts` (nuevo) **10/10**: lo que ve el comensal (platos, opciones, importes copiados, total, lista blanca de claves, sin observaciones, motivos ni ids), importes que no se mueven al cambiar el precio, `empty`; sin «Pedir la cuenta» (ni «Llamar al mozo» sirve), ticket anterior al turno, cerrar y anular rotan el turno, token malformado o nulo, mesa, sucursal u organización inactiva o plan sin llamado; `anon`, Dueño y ajeno no pueden ejecutarla y `anon` no lee `orders`, `order_items` ni `order_item_options`. `acl.rls.test.ts` suma `get_table_account` (solo `service_role`).
- **Mutaciones** (función cambiada en la base local y restaurada con `pnpm db:reset`): saltarse la condición de «Pedir la cuenta» → 4 pruebas fallan; saltarse `ticket_in_turn` → 1 falla; devolver la observación → 2 fallan. Las tres detectadas.
- `src/lib/cuenta/account.test.ts` (nuevo) **9/9**: lectura que falla cerrado (totales que no cierran, importes inválidos, formas inesperadas) y hora de la sucursal. `pnpm test`: 1058/1059; falla solo `textos.test.ts` (`feed.dockLink`, «Menufeed»), la falla ajena ya registrada.
- `e2e/cuenta-del-comensal.spec.ts` (nueva) **4/4** a 390 px: no se ofrece antes de pedir la cuenta; muestra platos, opciones, importes, total y leyenda sin lo cancelado ni las observaciones y sin desborde; cuenta pedida sin platos; cobrar la mesa y reiniciar el QR cortan el acceso (la hoja y la barra piden escanear de nuevo, sin un solo importe) y un escaneo nuevo no hereda la cuenta. Vecinas (`llamados`, `ticket-de-visita`, `resenas-carta`, `idiomas`, `feed-videos`, `sala-turno`): 54/54. `pnpm typecheck`, `pnpm lint` y `pnpm build`: correctos.
- **No corrido:** revisión independiente, staging, teléfono real, lector de pantalla, E2E completo, textos en inglés y portugués en pantalla (cubiertos por el tipo y la prueba de textos, no por una E2E).
