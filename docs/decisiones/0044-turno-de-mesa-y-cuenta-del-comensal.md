# 0044 — Turno de mesa y cuenta del comensal: el QR no cambia, lo que resuelve sí

- Estado: aceptada (aprobada por el usuario el 2026-10-24; implementación pendiente)
- Fecha: 2026-10-24

## Contexto
El ADR 0041 (decisiones 1 y 7) dejó los pedidos fuera del alcance del anónimo: solo el personal los lee y «Pedir la cuenta» es un llamado que muestra el total **al mozo**. El usuario quiere además que el **comensal vea su precuenta** en el celular cuando pide la cuenta, y que el QR «se renueve» al cobrar la mesa **sin cambiar el diseño impreso**. Un QR impreso codifica una URL fija: no puede cambiar solo. Regenerar el `qr_token` (ADR 0009) lo invalida y obliga a reimprimir.

La base ya tiene dos piezas: el **ticket de visita** (HMAC sin estado emitido en cada carga de `/t/{token}`, 3 h; ficha `ticket-de-visita`) y el **cierre de sesión 10 minutos después de atender «Pedir la cuenta»** (ficha `cerrar-sesion-al-atender-la-cuenta`), que compara la emisión del ticket con la atención del llamado.

## Decisión
1. **Turno de mesa.** `tables.turn_started_at` (timestamptz) marca el inicio del turno vigente. El QR y su token no cambian nunca por esto. Un ticket de visita **solo vale para ver la cuenta si se emitió después** del inicio del turno (comparación estricta, en segundos enteros; ante la duda, cierra y pide escanear de nuevo).
2. **Cuándo rota (`turn_started_at = clock_timestamp()`):** al cerrar o anular un pedido con mesa (`close_order`, `void_order`) y con el botón manual «Reiniciar QR de la mesa» de la Sala (`reset_table_turn`, cualquier miembro). Además vence el ticket a las 3 h (ya existente). **No rota al tocar «Pedir la cuenta»:** pedirla no termina la visita (siguen el postre y el café) y el botón lo toca cualquiera que escanee, así que un anónimo podría sacar a la mesa de su propia cuenta.
3. **Cuenta del comensal (solo lectura).** Una acción de servidor valida el ticket (HMAC) y llama con `service_role` a `get_table_account(p_token, p_ticket_at)`. Devuelve platos vigentes (nombre, opciones, cantidad, importe), total y cantidad, **solo si** hay un «Pedir la cuenta» de la mesa creado dentro del turno y el ticket es del turno. Nunca observaciones, motivos, personas, ids ni líneas canceladas. Sin pedido abierto: «todavía no hay platos anotados», sin revelar más. El anónimo **sigue sin permiso** sobre `orders` y `order_items`.
4. **Misma leyenda y mismos importes** que la precuenta del mozo (copia de lo anotado, «No válida como factura»).
5. **No se rota al «Pedir la cuenta» y no hay credencial por dispositivo:** pulsar el botón es trivial, así que atar la vista al aparato no agregaba protección y sí complejidad.

## Alternativas consideradas
- **Regenerar el `qr_token` al cobrar** — invalida el QR impreso (404): obliga a reimprimir en cada cobro.
- **Redirigir `/t/{token}` a `/t/{token}/{turno}`** — da una «dirección distinta» visible, pero el ticket ya cumple ese papel (se emite en cada carga, no se cachea) sin una ruta nueva ni enlaces compartibles de más.
- **Rotar al pedir la cuenta** — descartada (decisión 2).
- **Código que da el mozo, o geolocalización** — más fricción o no fiable; se acepta el riesgo de abajo.
- **Política de lectura para `anon` sobre pedidos** — expondría todo; se usa una función de solo servidor (patrón del ADR 0038).

## Enmienda (2026-10-25, feedback del usuario en staging)
El turno no solo decide quién ve la cuenta: **los llamados al mozo también terminan con él**. Con la versión original, al «Reiniciar QR de la mesa» el celular que ya estaba en la mesa seguía pudiendo llamar (el ticket de visita no miraba el turno). Ahora `create_waiter_call` responde `session_closed` (el aviso de siempre, «Esta sesión venció. Escaneá de nuevo el QR») si el turno empezó después de emitido el ticket, con la misma tolerancia de 1 segundo que el cierre de sesión por cuenta atendida y **sin** los 10 minutos de gracia de aquél. Vale para el cobro (`close_order`, `void_order`) y para el reinicio manual. Consecuencia para el comensal: después de que el mozo cierra el pedido, quien siga en la mesa y quiera llamar o pedir algo tiene que escanear de nuevo el QR.

## Enmienda 2 (2026-10-25): la visita vive en la URL, recargar no la renueva
Tras la enmienda anterior el usuario vio que **recargar la página** devolvía los botones aunque el turno ya hubiera terminado: `/t/{token}` emitía un ticket nuevo en cada carga porque, con un QR estático, una recarga es indistinguible de un escaneo (límite aceptado en el ADR 0010). Se resuelve dándole a cada visita **su propia dirección**, la «dirección dinámica» que el usuario pidió al principio: escanear el QR (`/t/{token}`, sin `v`) emite el ticket y **redirige** a `/t/{token}?v={ticket}` (conservando `lang`); **recargar reutiliza ese ticket** en vez de emitir otro. Si el turno empezó después de emitido (cobro o «Reiniciar QR»), la página no ofrece los botones y pide escanear de nuevo; el plazo de 3 horas tampoco se renueva al recargar. La base lo responde con `visit_in_turn(token, ticket)` (solo `service_role`, devuelve un booleano, misma regla y tolerancia de 1 s que `create_waiter_call`); la página **falla abierta** (si la consulta falla muestra los botones) porque la autoridad sigue siendo `create_waiter_call`. El feed `/t/{token}/videos` recibe la misma visita y el enlace de vuelta a la carta también.
- **Lo que no se puede evitar:** quien escribe la URL a mano sin `v` (o la edita) es, para el servidor, un escaneo, y recibe una visita nueva. Alcanza para el uso real (recargar, volver desde el historial o una pestaña restaurada) y no para quien lo busca a propósito, como ya decía el ADR 0010.
- La URL que se ve en el navegador es más larga (`?v=…`); el QR impreso no cambia.

## Enmienda 3 (2026-10-25): reinicio diario y de todo el local
El usuario pide horarios diarios editables por el Dueño, con **05:00** por defecto, y un botón de reinicio de todas las mesas para el mozo. Los horarios se configuran por sucursal en su zona horaria existente. Una lista vacía desactiva el automatismo; se recomiendan horarios de cierre. Un único trabajo de PostgreSQL cada minuto evita depender de que Fly esté encendido. El primer horario cuenta desde el alta o el guardado; tras una interrupción se recupera el último pendiente al volver el servicio, sin repetir cada horario perdido. El horario ambiguo por cambio estacional se interpreta como PostgreSQL (la segunda ocurrencia).

El reinicio masivo requiere membresía y confirmación, abarca todas las sucursales del local y conserva el criterio del reinicio individual: sin bloqueo por plan ni mora. Ambos mecanismos terminan visitas y vencen pedidos de cuenta pendientes, sin cambiar el QR impreso ni modificar pedidos. Los permisos, las pruebas y la recuperación están en la [ficha](../../agile/cambios/reinicio-programado-qr.md).
Reactivar una sucursal empieza a contar desde ese momento, sin ejecutar horarios que pasaron mientras estaba apagada. Los horarios se leen solo por una función del Dueño; el marcador de ejecución no es público.

## Enmienda 4 (2026-10-26): sugerencia opcional de propina
El usuario aprobó configurar la propina desde Sucursales y mostrarla en la cuenta del cliente y la precuenta imprimible. Se conserva el total consumido separado porque una sugerencia no acredita un cobro ni una venta. Cuenta y precuenta comparten el cálculo y usan la configuración vigente al consultar; no se añade un registro histórico de propina cobrada. El alcance previo «sin propinas» queda matizado únicamente para esta sugerencia visual. Reglas y evidencia en la [ficha](../../agile/cambios/propina-sugerida.md).

## Consecuencias
- **Riesgo aceptado por el usuario:** quien escanee el QR durante el turno, estando o no en el local, puede ver el consumo de esa mesa (platos y total, sin datos personales) **después de que se pidió la cuenta**. El turno limita cuánto dura, no quién. Se mitiga con el ticket, el cierre del turno y que el mozo ve cuándo escaneó.
- La función `get_table_account` y `reset_table_turn` son nuevas superficies; la primera solo `service_role`.
- `close_order` y `void_order` siguen sin bloquearse por mora o plan; la rotación va dentro de la misma transacción.
- Se actualiza `docs/producto.md` y las decisiones 1 y 7 del ADR 0041 quedan **matizadas** por este ADR (el anónimo lee únicamente la cuenta de su turno, por esta vía).
- Falta probar en teléfono real: escaneo, pedir la cuenta, ver la cuenta, cobro y re-escaneo.
