# 0042 — La identidad del cliente es por organización, con consentimiento, y se vincula a la visita o al pedido, nunca a la mesa

- Estado: aceptada (recomendaciones D5, D11 y D12 aprobadas por el usuario el 2026-10-23; implementación pendiente y bloqueada por revisión legal)
- Fecha: 2026-10-23

## Contexto
El usuario quiere reconocer a clientes que vuelven, recordar preferencias y preparar un historial de pedidos y la fidelización (ADR 0003, que preveía `loyalty_members` por teléfono). Pidió no vincular de forma permanente la identidad al QR de una mesa: el QR es un lugar y lo usan muchas personas. Son datos personales (Ley 25.326).

## Decisión
1. **Una sola identidad por organización** (`customers`): nombre, teléfono E.164 **único por organización**, email opcional y consentimiento (versión del texto, fecha y canal). El mismo teléfono en dos locales son dos registros que nunca se cruzan. Es la base de la futura fidelización: reemplaza a `loyalty_members` del ADR 0003.
2. **Primero lo identifica el personal:** el mozo busca por teléfono **exacto** (sin listado navegable para el Staff), da de alta con consentimiento y lo vincula al pedido. El Staff ve el teléfono enmascarado; el Dueño, completo.
3. **Nunca a la mesa:** la identidad se guarda en el pedido o la visita; ni la mesa ni el QR guardan a nadie, y una visita nueva en esa mesa no hereda al cliente anterior.
4. **Preferencias estructuradas, sin datos de salud** (alergias o condiciones son datos sensibles).
5. **Derechos del titular:** baja que borra sus datos y deja los pedidos sin vínculo; exportación; purga por retención.
6. Plan **Premium**. El alta del propio cliente desde la carta (código de dispositivo, como los likes) y el pase de Wallet como credencial quedan para después.

## Alternativas consideradas
- **Recordar al cliente por la mesa o el QR** — descartado por el usuario y por privacidad.
- **Verificación por código (SMS/WhatsApp)** — más segura, con costo y proveedor externo; se reevalúa si aparece abuso.
- **Identidad global entre locales** — expone datos entre organizaciones; contradice el invariante central.

## Consecuencias
- Bloqueado hasta revisar con un abogado el texto de consentimiento, el rol de UcoMenu como encargado del tratamiento y la inscripción de la base ante la AAIP por parte del local.
- Nivel C: aislamiento entre organizaciones, enmascarado y baja probados en RLS.
- El teléfono identifica, no autentica: alguien podría dar un número ajeno; el impacto es acotado porque solo el personal opera.
