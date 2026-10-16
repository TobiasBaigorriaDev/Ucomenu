# 0014 — Purga de `waiter_calls`: retención de 14 días, función de base solo para el servidor y piso de 7 días

- Estado: aceptada (el usuario fijó 14 días y aceptó la pérdida sin respaldo el 2026-10-16)
- Fecha: 2026-10-15

## Contexto
`waiter_calls` guarda `client_key`, un HMAC de la IP del comensal: un dato personal derivado que no debe conservarse indefinidamente (ADR 0010 dejó la purga como ítem posterior). Nada de lo que decide la base depende de filas viejas: cooldown (hasta 1 h), límite por cliente (10 min) y vencimiento (30 min); la sala lee los últimos 30 minutos. Tampoco hay programador en el proyecto.

## Decisión
`public.purge_waiter_calls(p_retention interval default '14 days', p_batch integer default 5000)` borra por `created_at` (cualquier estado), por lotes y con `skip locked`, y devuelve cuántas borró. Rechaza retenciones menores a 7 días y lotes fuera de 1–50 000. Solo `service_role` la ejecuta; los privilegios de la tabla no cambian. Cuándo se ejecuta es configuración de despliegue.

## Alternativas consideradas
- **Constante de 14 días dentro de la función** — cambiar el plazo exigiría una migración; con parámetro y piso se ajusta sin tocar el esquema y sin permitir el error peligroso.
- **Programarla en una migración con `pg_cron`** — decide infraestructura de producción (extensión, permisos, frecuencia) sin aprobación y no se prueba en local; se deja en el checklist de «Salida a producción».
- **Borrar solo los atendidos o vencidos** — un pendiente de semanas ya está vencido por derivación; conservarlo acumularía el dato que se quiere acotar.
- **Anonimizar `client_key` antes de los 14 días** — reduce más el dato personal, pero no se pidió y suma una segunda regla; se puede agregar después sin cambiar esta.
- **Escribir en `audit_log`** — es del SuperAdmin y exige un actor humano; la purga es una tarea técnica.

## Consecuencias
- El borrado es irreversible y no hay respaldo: el usuario aceptó esa pérdida (2026-10-16). Si más adelante se define un respaldo, no cambia la decisión.
- Bajar el plazo por debajo de 7 días exige una nueva decisión (migración que cambie el piso).
- El historial de llamados queda acotado a 14 días: no hay analítica histórica sobre `waiter_calls` más allá de ese plazo (la analítica de la fase 4 deberá agregar antes de purgar).
