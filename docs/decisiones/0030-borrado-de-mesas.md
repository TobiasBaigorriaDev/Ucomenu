# 0030 — Las mesas se borran con el cliente de la persona y sus llamados se van con ellas (cascada); un permiso `DELETE` nuevo sobre `tables`

- Estado: propuesta (implementada localmente; pendiente de la revisión independiente y la aprobación del usuario)
- Fecha: 2026-10-21

## Contexto
Las mesas solo se desactivaban ([ADR 0009](0009-mesas-y-qr-token-opaco.md)): «quitar una mesa con historial de llamados se resuelve cuando existan los llamados». Los llamados existen (ADR 0010) y su historial está acotado a 14 días ([ADR 0014](0014-purga-de-waiter-calls.md)): no guarda dinero, ninguna regla de la base lo usa (cooldown ≤ 1 h, vencimiento de 30 minutos) y su único lector es la estadística de llamados por franja horaria de los últimos 14 días.

## Decisión
1. **Los llamados se van con la mesa**, por la cascada que ya existía (`waiter_calls` → `tables`, `ON DELETE CASCADE`). No se guardan llamados huérfanos ni una copia de la etiqueta.
2. **Una migración mínima**: `GRANT DELETE ON tables TO authenticated` y una política `DELETE` con el mismo par que el `UPDATE` (miembro de la organización y cuenta que puede escribir). `anon` no gana nada; `waiter_calls` no cambia (la cascada corre con los privilegios del dueño de la tabla).
3. **Dueño y Staff**, como el resto de la gestión de mesas; con la cuenta en solo lectura o suspendida no se borra.
4. **Confirmación en dos pasos** (sin escribir nada: una mesa es barata de recrear y no guarda datos personales ni dinero). El QR impreso de una mesa borrada da el mismo 404 que uno desconocido o regenerado.

## Alternativas consideradas
- **Conservar los llamados sin mesa** (`table_id` nulo o copia de la etiqueta) — complica una clave foránea compuesta no nula y guarda `client_key` (dato personal derivado) más allá de la vida de la mesa, sin que nada lo lea.
- **Borrar solo si la mesa lleva tiempo inactiva** — fricción sin riesgo que justifique: no hay dinero en juego y «Desactivar» ya existe.
- **Función de base en lugar de permiso** — una función `SECURITY DEFINER` duplicaría la autorización que la RLS ya expresa para las demás escrituras de mesas.

## Consecuencias
- Irreversible: solo el respaldo (`docs/operacion.md`) lo cubre. Se recrea la mesa con un QR nuevo para imprimir.
- Se pierden los llamados de esa mesa de los últimos 14 días en la estadística por franja horaria.
- Un QR pegado en una mesa física borrada da 404 hasta que se retire.
