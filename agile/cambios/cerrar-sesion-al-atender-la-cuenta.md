# Cambio: Cerrar la sesión de la mesa al atender «Pedir la cuenta» (B1 de ticket-de-visita)
Estado: **hecho, sin revisión de un segundo agente** (nivel M; ver «Nivel»)
Nivel: **M** — endurece la puerta pública `create_waiter_call` sin dinero, permisos de terceros ni datos existentes; no hay esquema nuevo. Si se prefiere tratarlo como C por tocar la puerta pública, falta la revisión independiente.

## Objetivo
Cuando el personal atiende un «Pedir la cuenta», la visita de esa mesa terminó: las pestañas abiertas **antes** de esa atención dejan de poder avisar, sin trabajo extra del mozo (B1 del análisis de `ticket-de-visita.md`).

## Decisiones
1. **Dentro de `create_waiter_call`** (misma firma, misma puerta, mismos permisos; `create or replace`): si `p_visit_started_at` es verosímil y existe un llamado `bill` de la mesa con `status = 'attended'` y `attended_at >= p_visit_started_at + 1 s`, responde `{status: 'session_closed'}` y no crea nada. El ticket guarda segundos enteros: la emisión cae en `[t, t+1 s)`, así que solo cuenta como «posterior» una atención al menos un segundo después.
2. **`p_visit_started_at` deja de ser solo informativo**: además de guardarse, decide el cierre. Sin ticket verosímil (ausente, de hace más de 24 h o del futuro) no se compara nada; llamar directo a la API lo evita, igual que el ticket y el límite por cliente (ADR 0010).
3. **Orden en la función:** se comprueba después de la disponibilidad (mesa inactiva, silenciada, plan, mora → `unavailable`) y antes del pendiente único, el límite por cliente y el cooldown.
4. **Solo cierra la cuenta ATENDIDA de ESTA mesa.** Una cuenta pendiente o vencida, un «llamar al mozo» atendido y la cuenta de otra mesa no cierran nada.
5. **La app lo trata como un ticket vencido:** la acción traduce `session_closed` al mismo aviso («Esta sesión venció. Escaneá de nuevo el QR…») y la barra pasa al estado «vencida» (`expired: true`). Quien escanea o recarga recibe un ticket posterior y llama con normalidad (límite ya aceptado en `ticket-de-visita`).
6. Sin índice nuevo: usa `waiter_calls_table_kind_idx (table_id, kind, created_at)`; la purga de 14 días acota la tabla.

## Fricción conocida (decisión de producto, revisable)
Quien pide la cuenta y después quiere otro café vuelve a ver «escaneá de nuevo» al tocar un botón, porque su ticket es anterior a la atención de la cuenta. Es el costo de B1. Si molesta en el salón, se puede (a) no cerrar hasta pasados N minutos de la atención, o (b) volver a descartar B1.

## Aceptación
- [x] Un ticket anterior a la cuenta atendida no llama (ni «mozo» ni «cuenta»), no crea filas y la respuesta no dice más que el estado.
- [x] Un ticket posterior a la atención llama; el borde es el segundo del ticket (misma emisión: pasa; un segundo después: cierra).
- [x] Solo cierra la cuenta atendida de esa mesa (pendiente, vencida, «mozo» atendido y otra mesa no).
- [x] Sin ticket verosímil no se compara; la mesa inactiva sigue respondiendo `unavailable`.
- [x] E2E: la pestaña abierta antes de la atención recibe el aviso de vencida y no crea nada; tras recargar llama con normalidad.

## Evidencias (2026-10-16, base reseteada con la migración nueva, `pnpm build` previo)
- `pnpm test` **321/321** (+2 en `llamados.test.ts`) · `pnpm test:rls` **500/500** (+6 en `waiter-calls.rls.test.ts`; una sesión real de Staff atiende la cuenta) · `pnpm exec playwright test` **180/180** (+1 en `ticket-de-visita.spec.ts`) · `pnpm lint` y `pnpm typecheck` OK.
- No ejecutado: mutaciones de la defensa; revisión independiente; prueba en un teléfono real.

## Migración y rollback
- `20261016140000_cerrar_sesion_al_atender_la_cuenta.sql`: solo reemplaza la función; sin esquema ni datos. Solo local; nada contra remotos. **En staging/producción hay que aplicarla con las demás migraciones** (con aprobación).
- Rollback: `git revert` + `pnpm db:reset`; con datos, volver a aplicar la función de `20261014200000_ticket_de_visita.sql`.
