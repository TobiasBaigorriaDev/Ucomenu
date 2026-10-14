# 0011 — Panel de sala: sondeo corto al servidor en vez de Supabase Realtime

- Estado: aceptada
- Fecha: 2026-10-14

## Contexto
El panel de sala tiene que mostrar los llamados al personal «en vivo». `arquitectura.md` preveía Supabase Realtime con un canal privado por sucursal, pero el ADR 0007 decidió **no tener cliente de Supabase en el navegador** (sesión en cookies `httpOnly`, todo por *server actions* y rutas del servidor). Un canal de Realtime exige que el navegador se conecte con el *access token* de la persona, es decir, exponerlo a JavaScript.

## Decisión
*(Tomada por el usuario el 2026-10-14.)*
1. **Sondeo corto:** la pantalla de `/sala/{slug}` pide el estado a `GET /sala/{slug}/estado` cada ~3 s con la pestaña visible y ~15 s oculta, con espaciado creciente (hasta 15 s) tras errores y consulta inmediata al volver a la pestaña o recuperar la red. Cada respuesta **reemplaza** la lista completa: la tabla es la fuente de verdad, así que un evento perdido es imposible y la recuperación al reconectar es el propio ciclo.
2. **La ruta usa la sesión de la persona (RLS), no `service_role`**, y vuelve a comprobar identidad y membresía en cada pedido: sin sesión `401` (el *proxy* responde JSON en esta ruta en vez de redirigir al login), no miembro o local inexistente `404` idéntico, base caída `503`. Sin caché. Devuelve lo mínimo (hora del servidor, si está habilitado y los pendientes con mesa, tipo, sucursal y hora; nunca ids de mesa ni tokens).
3. **Atender** es una *server action* con el cliente de la persona; la base lo autoriza con una política de `UPDATE` solo sobre `status` (pending → attended), con el plan y la cuenta al día, y fija la hora y la persona con un *trigger*.
4. **El vencimiento a 30 minutos sigue siendo derivado** (ADR 0010): la sala no lista los pendientes más viejos.
5. **Alerta sonora y visual del lado del cliente**: doble pitido con Web Audio (tras un toque del usuario), título de la pestaña con la cantidad y *Wake Lock* para mantener la pantalla encendida.

## Alternativas consideradas
- **Supabase Realtime (canal privado por sucursal)** — llegada casi instantánea y es lo que decía la arquitectura, pero obliga a pasar el *access token* (1 h) al navegador (enmienda al ADR 0007), a levantar el contenedor `realtime` en local y a autorizar `realtime.messages` por RLS, con pruebas con WebSocket más frágiles. Se descartó por ahora.
- **Flujo continuo desde el servidor (SSE)** — sin token en el navegador, pero una conexión larga por dispositivo (límite de duración en el hosting, reconexión) y el servidor consultaría la base cada pocos segundos igual.

## Consecuencias
- **Latencia de hasta ~3 s** (hasta ~15 s con la pestaña oculta, que los navegadores ralentizan igual) y una consulta liviana por dispositivo cada 3 s: despreciable a escala MVP (uno o dos dispositivos por local), con un índice parcial por organización para los pendientes.
- El modelo no cambia si se suma Realtime después: la tabla sigue siendo la fuente de verdad y la pantalla ya recarga todo en cada ciclo; bastaría un canal que dispare el mismo ciclo antes. Hacerlo exigiría una enmienda al ADR 0007 sobre el token.
- Los celulares con la pantalla apagada o la pestaña en segundo plano pueden no sonar: se recomienda un dispositivo dedicado (*Wake Lock* ayuda con la pantalla encendida).
- El sonido requiere un gesto del usuario en cada carga; sin él la alerta es visual y del título.
- Atender depende del plan y de la mora: un pendiente al pasar a solo lectura ya no se puede atender (vence solo a los 30 minutos). Tampoco se puede atender uno de 30 minutos o más aunque siga `pending`: la política lo exige (mismo borde que la lista).
- El cliente hace una sola consulta a la vez y descarta las respuestas anteriores a una atención; con `enabled:false` deja de consultar.
- Quien agregue otra pantalla «en vivo» debe seguir este patrón: ruta de lectura con sesión y RLS, respuesta mínima, `401`/`404` uniformes y reemplazo completo de la lista en cada ciclo.
