# 0051 — Reservas de mesa, en el plan Pro, con confirmación manual por el personal

- Estado: aceptada (decidida por el usuario el 2026-10-31)
- Fecha: 2026-10-31
- Enmienda a: [`docs/producto.md`](../producto.md), que hasta hoy dejaba las reservas fuera de alcance.

## Contexto
El usuario quiere un sistema de reservas: desde la carta que comparte el Dueño, un botón flotante «Reservar» abre un cuestionario, el
comensal confirma su email, y el personal le asigna una mesa. El personal también tiene que poder cargar una reserva a mano (por
teléfono, WhatsApp o en persona). La Sala ya tiene mesas, sucursales, roles y avisos; no hay proveedor de correo, y las reservas
guardan datos personales de gente anónima (Ley 25.326), así que el cambio es de nivel C (exposición de datos personales).

## Decisión
- **Función `reservations` del plan Pro y Premium** (Básico no la tiene). Se registra en `plans.features` y en lo que informa
  `org_entitlements`.
- **Todo manual al principio:** una reserva pública llega como *solicitada* y el personal la confirma asignándole una mesa o la
  rechaza. No hay disponibilidad ni confirmación automática.
- **Datos que se piden:** nombre, **teléfono (obligatorio)**, **email (obligatorio en la reserva pública, opcional en la manual)**,
  cantidad de personas, fecha y hora, y una nota opcional. Consentimiento explícito en la pública.
- **Estados:** `pending_email` (la pública, hasta confirmar el email) → `requested` → `confirmed` (con mesa) → `seated`, y por fuera
  `rejected`, `cancelled` y `no_show`. Las reservas manuales nacen `requested` o `confirmed`.
- **Una sola puerta de escritura:** funciones de base `SECURITY DEFINER` (como `add_order_item`); nadie escribe la tabla por la API,
  ni siquiera `service_role`. Lee la tabla solo Dueño y Staff de la organización (no el cocinero, nunca un anónimo).
- **Sin mesa doble:** una mesa no puede tener dos reservas `confirmed` o `seated` con horarios que se superponen; lo comprueba la
  función bajo un candado por mesa (no se instala `btree_gist`: como solo las funciones escriben, el invariante vale igual).
- **Retención corta:** los datos personales se borran **30 días después** de terminada la reserva (`purge_expired_reservations`,
  la programa quien despliega, como la purga de llamados).
- **Fases:** 1) reservas manuales y asignación de mesa en la Sala (sin público ni email); 2) formulario público en la carta
  (botón «Reservar» solo en `/m/…`), confirmación por email con un proveedor transaccional (Resend, a aprobar al contratarlo),
  límites contra spam y aviso al personal por push; 3) disponibilidad automática, recordatorios y cancelación desde el email.

## Alternativas consideradas
- **Confirmar solo por WhatsApp:** muy usado en Argentina pero no se automatiza ni valida que el contacto sea del comensal; queda como
  complemento (el personal puede abrir el chat desde la reserva).
- **Exclusión con `btree_gist`:** más fuerte en la base, pero suma una extensión; sin escritura directa de nadie no hace falta.
- **Reserva pública sin confirmar el email:** abre la puerta al spam y a datos de terceros; se descarta.

## Consecuencias
- Aparece un tratamiento nuevo de datos personales: hay que actualizar la política de privacidad **antes de abrir el formulario
  público** (fase 2) y dejar la purga programada.
- La fase 2 depende de contratar y configurar un proveedor de correo (nuevo servicio, aprobación del usuario).
- Las reservas no tocan pedidos, mesas ni llamados: una reserva `seated` solo recuerda qué mesa se ocupó; abrir el pedido sigue
  siendo del mozo.
