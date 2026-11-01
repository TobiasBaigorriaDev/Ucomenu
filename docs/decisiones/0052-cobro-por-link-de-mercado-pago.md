# 0052 — El Dueño paga su suscripción con un link de Mercado Pago y el servidor registra el pago solo

- Estado: aceptada (diseño aprobado por el usuario el 2026-11-01)
- Fecha: 2026-11-01

## Contexto
Hoy el SuperAdmin cobra por fuera y carga cada pago a mano (ADR 0013, 0024). Con pocos clientes alcanza; con más, cada renovación es trabajo manual y un pago recibido puede tardar días en reflejarse (el cliente cae en mora sin culpa). Cobrar de forma **recurrente** (Mercado Pago Suscripciones) exige altas con tarjeta guardada, cambios de monto por inflación y por sucursales adicionales, reconciliación y manejo de cobros rechazados: es un incremento grande y de riesgo alto. Se necesita un paso intermedio que quite la carga manual sin esa complejidad.

La mora ya se deriva de fechas (ADR 0006): registrar un pago es mover `current_period_end`. Eso encaja con un cobro por período sin cron de suspensión.

## Decisión
1. **Un link de pago por período, pedido por el Dueño.** Desde Suscripción el Dueño pulsa «Pagar» y el servidor crea una *preferencia* de Checkout Pro de Mercado Pago. No hay tarjeta guardada ni cobro automático: cada período se paga con un link nuevo.
2. **El importe lo calcula el servidor, nunca el cliente.** Plan y ciclo de la suscripción + sucursales adicionales, con los precios de lista de la base. Se congela en una **intención de pago** (`payment_intents`) que viaja a Mercado Pago como `external_reference`.
3. **El webhook no se cree: se verifica.** Se valida la firma `x-signature` (HMAC-SHA256 con el secreto de la aplicación, comparación en tiempo constante, tolerancia de tiempo del `ts`) y **se vuelve a pedir el pago a la API de Mercado Pago** con el token del servidor. Lo que decide es la respuesta de la API, no el cuerpo del mensaje.
4. **Una sola función de base registra el pago** (`system_register_mp_payment`, solo `service_role`): toma el lock de la suscripción, es idempotente por ID de pago de Mercado Pago, comprueba que importe, moneda, plan y ciclo coinciden con la intención y **calcula la vigencia en la base**. Escribe en `payments` (método `payment_link`, referencia `MP <id>`) y en `audit_log` en la misma transacción, igual que el cobro manual.
5. **Falla cerrado ante lo que no cuadra.** Pago aprobado que no coincide (importe distinto, plan cambiado, intención ya pagada, intención de otra suscripción) **no extiende la vigencia**: queda como «a revisar» para el SuperAdmin, que lo resuelve con las acciones manuales que ya existen.
6. **Reconciliación sin cron:** al volver de Mercado Pago (y con un botón «Ya pagué, verificar») el servidor busca los pagos de esa intención por `external_reference` y llama a la misma función. Un webhook perdido no deja a nadie sin servicio.
7. **Sin dependencia nueva:** `fetch` a la API REST y `node:crypto` para la firma, no el SDK de Mercado Pago.
8. **El cobro manual no se retira.** Sigue siendo la vía de respaldo y la de corrección (anular y registrar).

## Alternativas consideradas
- **Mercado Pago Suscripciones (cobro recurrente):** es el objetivo posterior (tablero, Fase 4). Se pospone: exige tarjeta guardada, actualizar el monto de cada suscripción por inflación y por sucursales, y manejar rechazos y reintentos.
- **Confiar en el cuerpo del webhook:** cualquiera que conozca la URL podría extender su cuenta. Descartada.
- **Cron que suspende o reactiva según Mercado Pago:** agrega una pieza que puede atrasarse; la derivación por fechas ya resuelve la mora.
- **El Dueño elige el importe o el período en el cliente:** abre la puerta a pagar de menos. Descartada.
- **Reembolsos y contracargos automáticos:** el cobro revertido no quita la vigencia solo; se marca «a revisar» y el SuperAdmin anula el pago con `admin_void_payment`. Automatizarlo queda para después.

## Consecuencias
- Dos secretos nuevos por entorno (token de acceso y secreto del webhook; en staging, credenciales de **prueba**). Un token filtrado permite crear links y leer pagos; no mover dinero. Se guardan solo como secretos de Fly y nunca en Git, memoria ni prompts.
- La ruta del webhook es **pública** (sin sesión): su única defensa es la firma y la verificación contra la API.
- Un **contracargo** o reembolso posterior no quita la vigencia automáticamente: hay ventana entre el cobro revertido y que el SuperAdmin lo note.
- La comisión de Mercado Pago la absorbe UcoMenú: el precio de lista no cambia.
- Un pago se registra con un actor «sistema» fijo en `payments` y `audit_log`; el historial del Dueño lo muestra como un pago más.
- Se agrega una tabla (`payment_intents`) con retención como `payments` (ADR 0027); no guarda datos personales del pagador.
- Una intención abierta por suscripción: «Pagar» dos veces reutiliza el link vigente.
- **Actualización 2026-11-01 (ronda 1 de revisión):** (a) el `ts` de la firma se acepta en segundos o en milisegundos (la documentación de Mercado Pago y su SDK no coinciden y el HMAC usa el texto tal cual); (b) un reembolso o contracargo se guarda siempre por ID de pago (`payment_reversals`) y un candado por ID de pago ordena el registro contra la reversión, para que ninguna se pierda aunque se procesen a la vez; (c) «Ya pagué, verificar» considera los pedidos sin pagar de los últimos 30 días, aunque su link haya vencido.
