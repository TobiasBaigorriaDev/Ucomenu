# Cambio: Retención de pedidos (2 años desde el cierre) y su purga por lotes
Estado: **implementado en local (migración `20261129100000`); falta la revisión independiente (Codex), tu aprobación y aplicarla en staging.** Diseño confirmado por el usuario el 2026-10-24. Segunda mitad de la «ficha de cierre» de S3 «Pedidos del mozo» ([ADR 0041](../../docs/decisiones/0041-pedidos-del-mozo.md), decisión 8; [ADR 0043](../../docs/decisiones/0043-retencion-de-pedidos.md)); la primera es la [precuenta](sala-precuenta.md). La purga **con el borrado de la organización** ya existe ([estados y registro](pedidos-estados-y-registro.md), decisión 8).
Nivel: **C** — eliminación irreversible (se borran pedidos, líneas, opciones copiadas y el registro de solo-agregado) y exposición de información (pedidos de cualquier organización). Una purga acotada, por lotes y de datos con 2 años de antigüedad sería M por sí sola; se trata como C porque borra el **registro de solo-agregado** (hay que apagar su protección dentro de la transacción) y alcanza a todas las organizaciones.

## Objetivo
Que los pedidos no se acumulen para siempre: una función de base borra, por lotes, los pedidos **cerrados o anulados hace más de 2 años** con todo lo que cuelga de ellos. El plazo (2 años, a confirmar con el contador antes de producción) es un parámetro con piso de 1 año, no una constante.

## Decisiones (confirmadas por el usuario el 2026-10-24)
1. **Qué se purga:** el **pedido completo**: `orders`, `order_items`, `order_item_options` y los eventos de `order_events` de esos pedidos. Se cuenta desde `closed_at` (cierre o anulación). **Un pedido abierto no se purga nunca**, por antiguo que sea.
2. **Cómo se ejecuta:** `public.purge_expired_orders(p_retention interval default '2 years', p_batch integer default 500)`, como `purge_waiter_calls`: **solo `service_role`** (ni `anon`, `authenticated` ni un SuperAdmin por la API), por lotes (`for update skip locked`, los más viejos primero), una transacción por llamada, idempotente. Devuelve cuántos borró de cada cosa (`orders`, `items`, `options`, `events`, `cutoff`) para que quien la programe lo registre y repita hasta que `orders` sea menor que el lote.
3. **Piso de 1 año sobre el corte efectivo** (`now() - retención`, no comparando intervalos: el defecto que la revisión halló en la purga de llamados); retención nula, menor al piso o con desborde de fechas → `22023` (`invalid_retention`); lote fuera de 1 a 5000 o nulo → `22023` (`invalid_batch`). Nada se toca antes de validar.
4. **El registro se borra apagando su protección dentro de la transacción**, igual que `private.purge_organization_order_events`: `alter table public.order_events disable trigger order_events_no_update_delete` y se vuelve a encender antes de terminar; si algo falla o se revierte, el trigger queda encendido y las filas siguen. Solo se apaga si hay algo que borrar. **Costo conocido:** mientras corre el lote, quien anota o cambia un pedido espera un instante (el registro toma un bloqueo de tabla); por eso los lotes son chicos y se programa de madrugada.
5. **Atómico por lote:** eventos, opciones, líneas y pedidos del lote se borran en una sola transacción (si falla uno, no se borra nada de ese lote). Las líneas y las opciones salen también por la cascada de sus claves, pero se borran de forma explícita para contarlas.
6. **No se programa acá.** Quién la dispara y cuándo (pg_cron, tarea) es configuración de despliegue: queda documentado en `docs/produccion.md` (paso 4.c) y en «Salida a producción»; en local y en staging no hay programador. **No se ejecuta contra staging ni producción sin aprobación.**
7. **Sin rastro en `audit_log`** (es del SuperAdmin y exige un actor): el rastro es el conteo que devuelve la función y que registra quien la programe. Como `purge_waiter_calls`.
8. **Índice** parcial `orders (closed_at) where closed_at is not null` para que el barrido no recorra toda la tabla.
9. **Datos personales:** los pedidos no llevan datos del comensal (no hay cliente asociado hasta S4); solo ids de quien anotó (`created_by`, `opened_by`, `closed_by`, `actor_id`). El texto de privacidad no cambia por esta ficha; la vinculación de clientes (S4) tendrá su propia retención.

## Aceptación
- [x] `anon`, Dueño y Staff no pueden ejecutarla por la API (`42501`); `service_role` sí; los privilegios de las tablas no cambian (nadie escribe ni borra por la API).
- [x] Con los valores por defecto borra los pedidos **cerrados y anulados** de más de 2 años, de **cualquier organización**, con sus líneas, opciones y eventos, y devuelve los conteos; conserva los de 2 años menos un día, los recientes y **todo pedido abierto**, incluso uno abierto hace 3 años.
- [x] Los eventos de los pedidos conservados quedan intactos; tras la purga el registro **sigue siendo de solo-agregado** (el trigger está encendido: `UPDATE` y `DELETE` fallan, también con privilegios del dueño de la tabla).
- [x] Retención nula, menor a 1 año (también con meses o negativa o con desborde de fechas) o lote de 0, negativo, mayor a 5000 o nulo: `22023` y no se borra nada; 1 año exacto es válido.
- [x] Con un lote de N y más pedidos viejos: borra a lo sumo N, los más viejos primero; una segunda corrida sin nada que purgar no borra ni toma bloqueos de tabla; repetir hasta agotar es idempotente.
- [x] Un fallo a mitad del lote (borrado de pedidos rechazado) no deja nada borrado: ni eventos, ni opciones, ni líneas; y el trigger de solo-agregado queda encendido.
- [x] Un pedido bloqueado por otra transacción se salta sin esperar y se purga en la corrida siguiente.
- [x] La purga convive con pedidos que se anotan, cambian y cierran a la vez (sin errores ni interbloqueos), y con `admin_delete_organization` (lo ya aprobado sigue en verde).
- [x] La migración es aditiva y aplica a la primera con `pnpm db:reset`; `pnpm db:types` regenerado; `acl.rls.test.ts` declara la función nueva.

## Fuera de alcance
- Programar la ejecución (pg_cron o tarea) y probar el plazo con el contador (producción); purgar pedidos **abiertos** olvidados (un pedido que nadie cerró en años necesita otra decisión); archivar o exportar antes de borrar; analítica de pedidos (ficha aparte, y deberá tener en cuenta que los pedidos viejos desaparecen); retención de datos de clientes (S4).

## (C) Invariantes
1. Ningún rol de la API purga ni borra: solo `service_role` ejecuta la función; los privilegios de las tablas no cambian.
2. Nunca se borra un pedido abierto, ni uno cerrado o anulado hace menos de 1 año (ni por parámetro, ni con valores nulos o desbordados).
3. El pedido y todo lo que cuelga de él (líneas, opciones, eventos) se van juntos o no se va nada.
4. El registro de pedidos vuelve a quedar de solo-agregado al terminar, pase lo que pase.
5. Alcance exacto: solo `orders`, `order_items`, `order_item_options` y `order_events` de los pedidos purgados.

## (C) Fallos y recuperación
- **Parámetro inválido:** excepción `22023` antes de tocar datos.
- **Falla a mitad:** cada llamada es una transacción: no se borra nada de ese lote y el trigger queda encendido. Reintentar es seguro.
- **Se borró de más** (alguien la ejecuta con 1 año): irreversible; solo se recupera de un respaldo (`pnpm respaldo`). Mitigación: piso de 1 año, defecto de 2, solo el servidor la ejecuta y nunca toca pedidos abiertos.
- **Espera de los mozos durante un lote:** el bloqueo es breve (lotes de 500); si molestara, bajar el lote o la frecuencia.
- **Rollback:** `drop function public.purge_expired_orders(interval, integer); drop index public.orders_closed_at_idx;` (no hay otro cambio de esquema). Lo ya purgado no vuelve.

## Evidencia
Migración `20261129100000_retencion_de_pedidos.sql` (aplicada con `pnpm db:reset` a la primera; `pnpm db:types` regenerado); base local, 2026-10-24, sobre `9fcc707` + el diff de este cambio:
- `tests/rls/purga-de-pedidos.rls.test.ts` (nuevo) **10/10**: permisos (`anon`, Dueño y Staff `42501`; `service_role` sí; nadie borra pedidos por la API), qué purga (cerrados y anulados de más de 2 años de **dos organizaciones**, con líneas, opciones y eventos, y los conteos; se conservan 2 años menos un día, recientes y **todo abierto**, también uno de 3 y de 10 años), el registro que queda de solo-agregado (`UPDATE` y `DELETE` fallan con los privilegios del dueño) y la mesa que admite un pedido nuevo, parámetros (12 casos mixtos, negativos, `-infinity`, desborde y lotes; 1 año exacto válido), lotes (los más viejos primero, repetir llega a cero), **atomicidad** (un disparador de prueba rechaza el último borrado: no se pierde nada y el trigger sigue encendido), **fila bloqueada** por otra transacción (se salta en menos de 4 s y se purga al liberarse), **no toma el bloqueo del registro si no hay nada que borrar** (otra sesión lo retiene 6 s y la purga vacía vuelve en menos de 3) y convivencia con altas concurrentes.
- `acl.rls.test.ts` declara `purge_expired_orders: [false, false]`. Archivos RLS afectados (`purga-de-pedidos`, `acl`, `borrado-de-organizaciones`, `pedidos`, `pedidos-opciones`, `pedidos-estados`, `sala-anotar`, `sala-mesas`): **155/155**.
- **Mutaciones** (de a una, con `create or replace`, restauradas y comprobadas): 10 probadas, **10 detectadas**: sin piso de 1 año, purga pedidos abiertos, no borra los eventos, no vuelve a encender el trigger, lo apaga aunque no haya nada, sin `skip locked`, ignora el lote, sin orden de los más viejos (sobrevivía con 3 pedidos y lote 2; la prueba pasó a 8 pedidos y lote 3 y ya la detecta), sin validar el lote y ejecutable por `authenticated`.
- `pnpm typecheck` y `pnpm lint`: limpios. `pnpm test`: 1047 de 1048; la única falla es `textos.test.ts` («Menufeed»), ajena.
- Documentación: ADR [0043](../../docs/decisiones/0043-retencion-de-pedidos.md) y `docs/produccion.md` (paso 4.c, con el bloque de `pg_cron` y la comprobación).
- **No corrido:** suite RLS completa, E2E (no hay pantalla), la tarea de `pg_cron` (no existe en local), prueba con cientos de miles de pedidos, staging, producción.
