# Cambio: El comensal ve su precuenta al pedir la cuenta
Estado: **ficha escrita, sin implementar; depende de [turno de mesa](turno-de-mesa.md)** (aprobada por el usuario el 2026-10-24). Decisiones en el [ADR 0044](../../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md).
Nivel: **C** — exposición de información a anónimos (consumo de una mesa). Revisión independiente y aprobación del usuario antes de aplicar la migración en staging.

## Objetivo
Que quien toca «Pedir la cuenta» en `/t/{token}` vea en su celular qué se consumió y cuánto va, con «No válida como factura», sin que ningún anónimo gane permiso de lectura sobre los pedidos.

## Decisiones (particulares)
1. **Función `get_table_account(p_token text, p_ticket_at timestamptz)`**, `SECURITY DEFINER`, `search_path` vacío, ejecutable **solo por `service_role`** (ADR 0038). Resuelve el token como `resolve_table_qr`; devuelve `not_found` indistinto para token desconocido, mesa inactiva, organización inactiva o plan sin pedidos.
2. **Condiciones para devolver datos** (todas): ticket del turno (`private.ticket_in_turn`), existe un llamado `bill` de la mesa creado dentro del turno (pendiente o atendido) y hay un pedido `open` de la mesa. Si falta el pedido: `{status:'empty'}`; si falta el llamado o el turno: `{status:'unavailable'}` (la app lo muestra como «escaneá de nuevo»).
3. **Contenido:** por línea no cancelada, nombre, opciones, cantidad, importe por línea (`cantidad × (efectivo + opciones)`, lo copiado al anotar), total, cantidad de platos, nombre del local, etiqueta de mesa y hora de la sucursal. **Nunca** observaciones, motivos, personas, ids ni líneas canceladas.
4. **Acción de servidor** en `/t/[token]`: verifica el ticket (HMAC) y llama con `createAdminClient()`. Clave de conexión y límite: reutilizar el de `placeCall` para evitar sondeos masivos (tope por cliente a definir al implementar).
5. **UI:** tras «Pedir la cuenta» (creada o ya pedida) aparece «Ver mi cuenta» en la barra de la mesa; se abre una hoja con la precuenta, el total y la leyenda; se vuelve a leer al abrirla (no se cachea). Textos en los tres idiomas. A 390 px, sin desborde. Ticket vencido o turno rotado: mismo aviso «Esta sesión venció. Escaneá de nuevo el QR».
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
- [ ] Sin «Pedir la cuenta» en el turno no se devuelve ningún dato; con ticket anterior al turno tampoco.
- [ ] Tras pedirla: platos vigentes, opciones, importes, total y leyenda; sin observaciones ni canceladas.
- [ ] Pedido cerrado, anulado, mesa inactiva, token ajeno o malformado: mismo `unavailable`/`not_found`, sin pistas.
- [ ] `anon`/`authenticated` no pueden ejecutar la función ni leer `orders`.
- [ ] Reiniciar el QR o cerrar la mesa corta el acceso del ticket anterior (E2E con dos contextos).
- [ ] Tres idiomas; 390 px sin desborde; ticket vencido muestra el aviso de siempre.

## Pruebas previstas
RLS/permisos con el rol de servicio y sin él; unitarias de la forma de la respuesta y del recorte de campos; E2E de punta a punta (pedir la cuenta → ver → cobrar → reescaneo). Mutaciones: saltarse la condición del llamado, `ticket_in_turn` no estricto, incluir observaciones.

## Fuera de alcance
Pago desde el celular, propinas, división de cuenta, factura, historial del comensal, identificar a la persona (ADR 0042).
