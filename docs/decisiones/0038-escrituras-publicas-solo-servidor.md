# 0038 — Las escrituras públicas de la mesa (llamado, likes, comentarios) las ejecuta solo el servidor

- Estado: aceptada
- Fecha: 2026-10-23

## Contexto
`create_waiter_call` (ADR 0010), `set_video_like` y `submit_video_comment` (ADR 0031) eran funciones de base ejecutables por `anon`. La acción de servidor verifica el ticket de visita (HMAC) y arma la clave de conexión (HMAC de la IP), pero la base no puede verificarlos: los recibe como parámetros opcionales. Quien tuviera la clave pública y un token de mesa podía llamar a la función directo, omitirlos y esquivar la sesión cerrada, el límite por conexión y la deduplicación. En comentarios, Codex lo marcó como hallazgo y el usuario lo aceptó como excepción provisoria (ficha `comentarios-del-feed`).

## Decisión
Las tres funciones se ejecutan **solo con `service_role`** (`revoke … from public, anon, authenticated`; `grant … to service_role`). La acción de servidor de `/t/{token}` y de `/t/{token}/videos` pasa a llamarlas con el cliente de servicio, después de verificar el ticket y armar las claves. Nada del navegador llama a la base para escribir. Las reglas de adentro (token, vigencia, topes, mora, plan) no cambian.

## Alternativas consideradas
- **Firma del ticket verificable en la base (HMAC con un secreto guardado en la base):** mantiene la llamada con la clave pública, pero agrega un secreto en la base, su rotación y más lógica en SQL para un resultado equivalente.
- **Dejar el límite aceptado:** quedaba un tope por organización pero la deduplicación y la sesión cerrada seguían eludibles.

## Consecuencias
- Cierra el límite conocido de los ADR 0010 y 0031: ya no hay un camino público que omita el ticket ni la clave de conexión.
- La escritura pública depende de `SUPABASE_SERVICE_ROLE_KEY` en el servidor (ya la usan el personal, el push y SuperAdmin). Sin ella, llamar, dar like y comentar fallan con un error de la acción (no con el mensaje «no disponible»); la lectura de la carta no se ve afectada.
- La clave de servicio ahora está en la ruta de una acción pública: las funciones siguen siendo la única puerta (`SECURITY DEFINER`, validan todo adentro) y el módulo `admin.ts` sigue siendo `server-only`. Una vulnerabilidad en la acción ya no tiene el tope de `anon`, solo el de lo que esas tres funciones permiten.
- `record_dish_view` (analítica) es una función pública parecida y queda fuera: no escribe contenido, solo cuenta, y no depende de ticket ni de conexión.
