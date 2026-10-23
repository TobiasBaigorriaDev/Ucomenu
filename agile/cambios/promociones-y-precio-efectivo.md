# Cambio: Promociones y función de precio efectivo
Estado: **implementado y verificado en local (2026-10-23); pendiente de la revisión independiente y de la aprobación humana.** Segunda pieza de S2 ([ADR 0040](../../docs/decisiones/0040-promociones-programadas.md), decisiones 2 a 7), desbloqueada por la [zona horaria por sucursal](zona-horaria-por-sucursal.md).
Nivel: **C** — el precio que se exhibe al público (Ley 24.240, art. 7), el catálogo de planes (Pro y Premium ganan una función) y una purga irreversible (el borrado de organizaciones suma la del historial). Ninguna pantalla cambia todavía: el panel y la carta son las dos fichas siguientes.

## Objetivo
Que la base sepa qué promociones hay, quién las puede escribir, qué cambió y cuánto cuesta un plato **ahora** en una sucursal. La carta y los pedidos del mozo (ADR 0041) leerán la misma función, así que no pueden calcularlo distinto.

## Decisiones (particulares)
1. **`promotions` entra al catálogo de planes**: `plans_features_check` suma `promotions` y se concede a Pro y Premium (ADR 0040, decisión 6). Las vistas previas ([ficha](vistas-previas-de-funciones.md)) pueden concederla a un Básico por tiempo limitado.
2. **Modelo.** `promotions` (nombre 1–80 sin espacios en los bordes; tipo `percent` 1–100 | `amount` ≥ 1 centavo | `fixed_price` ≥ 0; días en una **máscara de bits** lunes = bit 0, de 1 a 127; franja en **minutos del día**: `start_minute` 0–1439 inclusivo, `end_minute` 1–1440 exclusivo, distintos; `starts_on`/`ends_on` opcionales; `all_branches`; pausa `is_active`), `promotion_targets` (exactamente un plato **o** una categoría) y `promotion_branches`. Claves foráneas **compuestas con la organización** en todo: una promoción no puede apuntar a platos, categorías ni sucursales de otra. Minutos y máscara en vez de `time[]`/`int[]` para que ni los `CHECK` ni la réplica en TypeScript dependan de subconsultas ni de formatos.
3. **Semántica del horario** (la misma en SQL y en `precio.ts`): reloj de pared de la sucursal; los segundos no cuentan; `end_minute < start_minute` cruza la medianoche y **pertenece al día en que empieza**; `starts_on`/`ends_on` (inclusivos) se miden sobre el día en que **empieza** la franja (una franja que empieza el último día sigue después de medianoche, y la de la madrugada del primer día pertenece al día anterior, que no entra); con horario de verano rige la hora de pared. «Todo el día» es 0–1440.
4. **Precio.** `public.effective_prices(p_branch, p_product default null, p_at default null)`: precio propio de la sucursal o base → candidatas en curso → **solo si dejan el precio estrictamente por debajo** del de lista → gana el más bajo (empate: la más antigua por `created_at`, luego `id`) → piso de 0. Porcentaje: `base × (100 − p) / 100`, mitad hacia arriba, en enteros (`bigint`). Monto: `base − monto`, piso 0. Precio fijo: el valor (uno mayor o igual al de lista no se aplica). Solo toca el precio base: variantes y adicionales no cambian.
5. **Qué devuelve y a quién.** Sin `p_product`: solo los platos de la organización con una promoción en curso (la carta pone el resto con su precio de siempre). Con `p_product`: una fila de ese plato, con promoción o sin ella (los pedidos); ninguna si el plato no es de la organización de la sucursal. Ninguna fila si la sucursal está desactivada o la organización no está publicada. `SECURITY DEFINER` con `search_path` vacío, `EXECUTE` para `anon`, `authenticated` y `service_role`. Devuelve `ends_local` (cuándo termina la franja en el reloj de la sucursal, `timestamp` sin zona) en vez de un instante: es lo que la carta muestra («hasta las 22:00») y evita invertir horas de pared en los saltos del horario de verano.
6. **`p_at` solo lo respeta un miembro de la organización.** Para `anon` y para cualquier otra persona el instante es siempre el actual: pedir una hora futura no destapa una promoción que todavía no empezó. Es lo que permite la vista previa por día y hora del Dueño sin filtrar lo programado a la carta.
7. **Plan y mora, al leer y al escribir.** Se **aplican** si `private.plan_grants(org, 'promotions')` (plan o vista previa vigente) y la organización está publicada: con la cuenta en **solo lectura siguen aplicándose** (la carta no cambia de precio por la mora; el precio ya exhibido obliga) y con la cuenta suspendida no hay carta. Se **escriben** solo con `private.can_manage_promotions` = Dueño y `has_feature(..., 'promotions')` (que ya excluye solo lectura y suspendida): el Staff las lee y no las toca; `anon` no tiene acceso a las tablas.
8. **Historial de solo-agregado** (`promotion_history`, como `price_history`, ADR 0012): un trigger `SECURITY DEFINER` registra alta, cambio (solo si algo cambió: `old.* is distinct from new.*`), baja, y cada plato, categoría o sucursal que entra o sale, con la persona (`auth.uid()`, nulo para el servicio técnico) y una copia de la fila. La baja de una promoción deja **una** constancia con sus platos y sucursales (BEFORE DELETE); los retiros por cascada de esa baja no escriben, y el retiro por borrado de un plato o categoría sí. Sin clave foránea a la promoción ni a la persona; **RESTRICT a la organización**. Ni la API ni `service_role` pueden escribir, cambiar ni borrar (`revoke` + triggers que fallan, también para `TRUNCATE`).
9. **Borrado de organizaciones.** `private.purge_organization_promotion_history` (sin `EXECUTE` para nadie; rechaza una organización activa) la llama `admin_delete_organization` justo después de la purga de `price_history`, que es la que exige la baja auditada de 30 días. Cambia en esa función solo la llamada y la cifra (`promotion_history_purged`, en la auditoría y en el resumen). La cascada del borrado no escribe en el historial: los triggers comprueban que la organización (o la promoción) siga existiendo, y el `BEFORE DELETE` devuelve `OLD` en ese camino para no cancelar el borrado.
10. **Sin topes técnicos por organización** (cantidad de promociones o de objetivos): el costo de la función crece con ellas, pero solo las del propio local. Riesgo aceptado hasta tener uso real (anotado en «Riesgos»).

## Invariantes
- Ninguna promoción apunta a otra organización (claves compuestas, probado con plato, categoría y sucursal ajenos).
- El precio efectivo nunca es negativo ni mayor al de lista; sin promoción en curso es exactamente el de lista.
- Una promoción futura no sale de la base para quien no es miembro, ni con `p_at`.
- El historial no se reescribe ni se borra salvo por la purga del borrado de organizaciones.
- La mora no cambia el precio exhibido en gracia ni en solo lectura.

## Fallos y recuperación
- Si un cambio de plan o una vista previa terminada quita la función, las promociones **dejan de aplicarse** (la carta vuelve al precio de lista), no se borran: se reanudan al volver a tenerla.
- Una promoción sin objetivos, o de sucursales sin filas con `all_branches = false`, no aplica a nada (falla cerrado).
- La función no cuenta con una zona inválida: `branches.timezone` tiene un `CHECK` de lista cerrada y Postgres conoce cada una (probado).
- Rollback: en la cabecera de la migración (volver a crear `admin_delete_organization`, soltar funciones y tablas; **conservar `promotion_history`** si tiene filas).

## Aceptación
- [x] `effective_prices` da lo mismo que la réplica `precio.ts` para cada fila de la tabla de casos común (23 escenarios, 65 sondas): medianoche (Buenos Aires y Madrid), fechas con franja que cruza, horario de verano de Nueva York (salto de primavera y repetición de otoño), todo el día, bordes (inicio inclusivo, fin exclusivo, segundos), redondeo, piso, precio fijo mayor o igual al de lista, gana el más bajo, empate por antigüedad, pausa, categoría, sucursales, precio propio de la sucursal como base y reloj de cada sucursal. La réplica se alimenta con las **filas leídas de la base**, no con la tabla.
- [x] Solo el Dueño con la cuenta al día y la función en el plan escribe; el Staff, otra organización y `anon` no; Básico no, salvo con una vista previa vigente (y deja de poder al vencer); en gracia sí, en solo lectura y suspendida no.
- [x] Valores fuera de regla rechazados con `23514` (16 casos) y los límites que sí valen aceptados; las claves (`organization_id`, `id`, `created_at`) no se cambian por la API.
- [x] El historial registra las siete clases de evento con la persona, no registra cambios vacíos, deja una constancia por baja con sus objetivos y sucursales, sobrevive a la promoción, y nadie (Dueño, Staff, servicio técnico, `anon`) lo escribe, cambia ni borra; con privilegios de dueño de la tabla `UPDATE`, `DELETE` y `TRUNCATE` fallan.
- [x] `anon` ve la promoción en curso y no la futura (tampoco con `p_at`); el miembro sí puede verla con `p_at`; sin la función en el plan, con la sucursal desactivada, la organización dada de baja o suspendida, o un plato de otra organización: sin promoción / sin filas; en solo lectura sigue aplicándose.
- [x] Borrar una organización con promociones, objetivos, sucursales e historial funciona (la cascada no escribe) y sin purgar el historial el `RESTRICT` lo frena.

## Evidencia
Migración `20261123100000`, sobre el diff de `main` (2026-10-23):
- `pnpm db:reset` (migración aplicada a la primera) y `pnpm db:types`; `pnpm typecheck` en verde.
- Unitarias de `src/lib/promociones` 30/30 (23 escenarios + piezas del cálculo).
- RLS `promociones` 50/50. La corrida completa de RLS, el lint, el build y los resultados finales: ver «Cierre» más abajo.
- No probado: la función con volumen real (miles de platos por sucursal; el índice por plato y categoría de los objetivos está), una carta que la llame (todavía no existe) y staging (la migración no está subida).

## Riesgos aceptados y fuera de alcance
- Sin topes de promociones por organización (decisión 10).
- Dos promociones que se pisan no avisan todavía: el aviso de superposición es del panel.
- Una página abierta al cambiar la franja muestra el precio anterior hasta recargar (ADR 0040, consecuencias).
- Panel del Dueño, carta con precio promocional, pantalla del historial y pedidos: fichas siguientes.
