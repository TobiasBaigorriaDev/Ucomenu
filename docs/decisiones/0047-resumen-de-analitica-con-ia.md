# 0047 — Resumen de la analítica con IA: el servicio redacta sobre cifras ya calculadas y el Dueño decide qué hacer

- Estado: aceptada (el usuario eligió el 2026-10-25 la opción «resumen con acciones», empezar con Gemini y pasar a Claude antes de usar ventas reales)
- Fecha: 2026-10-26

## Contexto
La analítica de pedidos ([ADR 0045](0045-analitica-de-pedidos.md)) entrega muchas cifras y gráficos; al Dueño le cuesta saber qué hacer con ellas. Una IA puede redactar lo importante y sugerir qué probar. A diferencia de las traducciones ([ADR 0046](0046-sugerencia-de-traducciones-con-ia.md)), lo que sale a un tercero son **cifras de ventas de un negocio**, no textos públicos: hay que decidir qué se envía, cómo se evita que el texto engañe y quién lo puede leer.

## Decisión
1. **El servicio redacta; no calcula ni decide.** Se le entregan hechos ya calculados (agregados, porcentajes, comparación con el período anterior) y devuelve un párrafo, hasta cuatro hallazgos y hasta cuatro acciones para probar, como hipótesis. Nada se aplica solo: las acciones son texto; el Dueño decide.
2. **Qué sale a un tercero:** agregados y nombres de platos y categorías (públicos en la carta). **Nunca** los motivos de anulación o cancelación (texto libre del personal, puede nombrar a un comensal), ids, personas ni correos. Los nombres viajan como datos y se instruye ignorar cualquier orden escrita en ellos.
3. **Se desconfía de la respuesta:** forma y topes exactos, sin direcciones ni marcas, y toda cifra «importante» del texto (tres cifras o más, o seguida de «%») debe estar en los hechos; si no, se reintenta una vez y luego se descarta. Se muestra como texto plano, rotulado «Generado por IA», con la fecha y el servicio, y recordando que los números exactos están en la pantalla.
4. **Se guarda el último resumen por período y alcance** en una tabla (`analytics_summaries`) con una única puerta de escritura (`save_analytics_summary`). Guardarlo evita gastar en cada visita, permite el aviso de «ya generado» y mantiene visible el resumen aunque el servicio falle después. Lo lee solo el Dueño actual con `analytics`; la API no escribe directamente, ni siquiera el servicio técnico.
5. **Gasto acotado:** mínimo de 5 pedidos, 10 minutos entre dos generaciones del mismo período y alcance, sesión del Dueño con el plan.
6. **Proveedor intercambiable, con una regla de entorno:** la clave gratuita de Gemini permite a Google usar lo enviado para mejorar sus productos, así que sirve solo con **datos ficticios** (local y staging). **Antes de producción, con ventas reales, se usa un servicio de pago** (Claude, por decisión del usuario) y esto queda en el checklist de producción. El código cambia en un solo punto.
7. **Solo el Dueño**, como la analítica; sin límite de plan adicional.

## Alternativas consideradas
- **Resumen calculado con plantillas, sin IA:** cero riesgo y cero gasto, pero frases rígidas que no priorizan ni sugieren acciones adaptadas; queda como respaldo si el servicio falla (no implementado).
- **Dejar que el modelo consulte la base (texto a SQL):** abre superficie de autorización y de inyección; se descartó. La idea de «preguntarle a los datos» (C) usaría los mismos agregados, no SQL.
- **No guardar el resumen (regenerar en cada visita):** más simple, pero gasta en cada carga, no permite cooldown y se pierde si falla el servicio.
- **Guardar con la clave de servicio desde la acción:** una puerta más de escritura con un permiso grande; la función `SECURITY DEFINER` valida lo mismo con menos poder.
- **Enviar también los motivos de anulación:** enriquecería el resumen, pero el texto libre puede traer datos personales y órdenes ocultas; se descartó. Solo viajan las cantidades.

## Consecuencias
- Un secreto de servidor ya existente (`GEMINI_API_KEY`) cubre ahora dos funciones; pasar a producción con Claude pide su propia clave y aprobación, y revisar si la política de privacidad debe nombrar a los proveedores de IA.
- Los resúmenes viejos no se conservan (uno por período y alcance); desaparecen con la sucursal o la organización.
- No hay tope diario por local: lo acotan el mínimo de pedidos, los 10 minutos y la sesión del Dueño. Si el gasto lo exigiera, se agrega después sin cambiar la pantalla.
- Una cifra pequeña mal redactada (horas, conteos de tres cifras o menos sin «%») no se detecta; las cifras importantes sí. La pantalla siempre muestra los números reales al lado.
