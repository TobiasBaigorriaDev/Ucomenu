# 0010 — Llamado desde la mesa: una función de base como única puerta de escritura pública y límite por cliente como segunda línea

- Estado: aceptada
- Fecha: 2026-10-14

## Contexto
«Llamar al mozo» y «Pedir la cuenta» son una **escritura pública y sin sesión**: el comensal solo tiene el token de su mesa (ADR 0009). La clave pública de Supabase permite llamar a las funciones de la base directamente, sin pasar por la app, así que toda regla que importe tiene que vivir en la base. A la vez, el producto pide un límite por IP, y la IP solo la conoce el servidor de la app. Hay que decidir cómo se combinan.

## Decisión
1. **Única puerta de escritura:** `public.create_waiter_call(p_token, p_kind, p_client)`, `SECURITY DEFINER` con `search_path` vacío. **Ningún rol de la API** (`anon` ni `authenticated`) tiene `INSERT`, `UPDATE` ni `DELETE` sobre `waiter_calls`; los miembros del local solo la **leen** (RLS por organización). «Marcar atendido» llegará con el panel de sala, con su propia política.
2. **La función decide todo y no lanza errores en los flujos normales:** devuelve `created`, `already_pending`, `cooldown`, `rate_limited` (con los segundos de espera), `unavailable` o `not_found`. Sin plan, con la cuenta en solo lectura o suspendida, con la mesa inactiva o silenciada, el resultado es el mismo `unavailable` (no revela la causa); un token o tipo inválido es `not_found`.
3. **Un pendiente por (mesa, tipo)**, también con concurrencia: índice único parcial, *advisory lock* por mesa y, de respaldo, un manejador de la violación de unicidad. **El vencimiento a los 30 minutos es derivado** (sin proceso programado): antes de decidir, la función marca `expired` los pendientes viejos de esa mesa para que no bloqueen el índice.
4. **Cooldown de 60 s por mesa y tipo** (configurable por sucursal, `branches.waiter_call_cooldown_seconds`), contado desde la creación del llamado anterior del mismo tipo.
5. **Límite por cliente como segunda línea (decisión del usuario, 2026-10-14):** la función queda **abierta a `anon`** y recibe un identificador de cliente como parámetro; cuenta hasta **30 llamados nuevos cada 10 minutos por identificador**, sumando todas las mesas. El servidor de la app arma el identificador como **HMAC-SHA256 de la IP** con un secreto de servidor, truncado a 32 hex, y **nunca guarda ni registra la IP**. El tope es generoso a propósito: muchas mesas comparten el Wi-Fi del local.
6. **El comensal no usa `service_role`:** la *server action* de `/t/{token}` llama a la función con el cliente `anon`. Los botones solo aparecen si `resolve_table_qr` informa `calls_enabled`; aunque alguien fuerce la acción, la base responde «no disponible».

## Alternativas consideradas
- **Función cerrada a `anon` y llamada desde la app con `service_role`** — haría inevitable el límite por IP, pero la ruta pública de la carta pasaría a usar la clave de servicio (hoy confinada al módulo de personal, ADR 0007) y cualquier error en esa ruta tendría un alcance mucho mayor. El usuario la descartó.
- **Solo cooldown y un pendiente por tipo, sin límite por IP** — lo más simple y sin dato derivado del comensal, pero un QR fotografiado de varias mesas permitiría un aviso por minuto por mesa sin freno global.
- **Cooldown por mesa (cualquier tipo)** — bloquearía «Pedir la cuenta» pocos segundos después de llamar al mozo; por tipo cada uno sigue acotado a un llamado por minuto.
- **Vencimiento con un proceso programado** — puede atrasarse o no correr, y un pendiente viejo bloquearía el índice único; derivado no tiene ese problema.
- **Guardar la IP en claro o un hash sin secreto** — la IP es dato personal y el espacio de IPv4 se recorre en segundos; el HMAC con secreto no se revierte sin la clave.

## Consecuencias
- **El límite por cliente se puede eludir llamando a la API directamente** con identificadores distintos. El tope duro es por mesa (cooldown y pendiente único) y hace falta un token de mesa (122 bits); se mitiga con regenerar el QR y, cuando exista su UI, silenciar la mesa.
- **`client_key` es un dato derivado de la IP** y se conserva hasta que exista la purga (propuesta: 30 días). Debe figurar en los textos legales (ley 25.326).
- **`WAITER_CALL_CLIENT_SECRET`** debe definirse en producción; sin ella se usa un secreto efímero por proceso (el límite funciona dentro de cada instancia pero no entre instancias ni tras reinicios). No es una credencial de acceso a datos.
- Detrás de un *proxy* la IP sale de `x-forwarded-for` (o `x-real-ip`) y su confiabilidad depende del hosting; sin una IP válida no se aplica el límite por cliente.
- El panel de sala debe tratar como vencido todo pendiente con más de 30 minutos aunque nadie haya llamado de nuevo, y agregar su política de `UPDATE` para «atendido».
- `waiter_calls` crece con el uso (acotado por el cooldown); la purga es un ítem posterior.
- Quien agregue otra escritura pública sin sesión debe seguir este patrón: una función con salida mínima, sin permisos de tabla, con resultados uniformes y pruebas de concurrencia.
