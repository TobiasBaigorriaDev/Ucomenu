# Cambio: Purga de `waiter_calls` por antigüedad
Estado: corregido tras la revisión (aprobar con cambios) — falta confirmar las correcciones y la aprobación del usuario del plazo
Nivel: C  <!-- eliminación irreversible de datos que incluyen un identificador derivado de la IP -->

## Objetivo
Que los llamados al mozo no se acumulen para siempre: una función de base borra los de más de 30 días, para que el dato derivado de la IP (`client_key`) no se conserve más de lo necesario. Cierra el prerrequisito legal de producción; los textos legales siguen en su propio ítem.

## Decisiones
- **Retención: 30 días** (propuesta del tablero; el usuario pidió arrancar sin fijar otro plazo). Es un parámetro con piso de 7 días, no una constante: cambiarla no exige migración. Motivos duraderos: ADR 0014.
- **Sin respaldo definido ⇒ se queda en C.** Lo purgado no vuelve; por eso el plazo es holgado, hay piso y la función no tiene ningún camino de ejecución público.
- **Se borra por `created_at`, sea cual sea el estado.** Un pendiente de más de 30 minutos ya está vencido por derivación (ficha del llamado), así que uno de semanas no es un aviso vivo.
- **Piso de 7 días, validado sobre la fecha de corte efectiva** (`now() - retención`), no comparando intervalos (ver «Revisión»): nada que decida la base (cooldown ≤ 1 h, límite por cliente de 10 min, vencimiento a 30 min) ni que lea la sala (últimos 30 min) mira filas de más de 1 día. Una retención menor, nula, o un lote fuera de rango (1–50 000) se rechazan con `22023`.
- **Por lotes con `for update skip locked`:** acota bloqueos y no compite con `create_waiter_call` ni con «atender». Devuelve cuántas borró; quien la programe repite hasta que devuelva menos que el lote.
- **Solo `service_role` la ejecuta.** Quién la dispara y cuándo (pg_cron, tarea programada o ruta protegida) es configuración de despliegue y queda en el checklist de «Salida a producción»; en local no hay programador.
- **Sin rastro en `audit_log`** (es del SuperAdmin y exige un actor): el rastro es el conteo que devuelve la función y que registra quien la ejecute.

## Aceptación
- [x] Dado `anon`, Dueño o Staff, cuando llaman `purge_waiter_calls` por la API, entonces `42501` y no se borra nada; tampoco pueden borrar `waiter_calls` directamente.
- [x] Dado `service_role`, cuando purga con los valores por defecto, entonces se borran los llamados de más de 30 días de cualquier estado y de cualquier organización, y se conservan los de 29 días o menos.
- [x] Dada una retención menor a 7 días, nula, o un lote de 0, negativo, mayor a 50 000 o nulo, entonces `22023` y no se borra nada; 7 días exactos es válido.
- [x] Dado un lote de N, cuando hay más filas viejas, entonces se borran como mucho N, las más viejas primero, y la función devuelve la cantidad.
- [x] Dada una segunda corrida inmediata, entonces no borra nada propio (idempotente).
- [x] Dados llamados entrando durante la purga (12 en paralelo con 4 purgas), entonces no hay errores ni interbloqueos y queda un solo pendiente.
- [x] Tras purgar, el cooldown y `already_pending` siguen funcionando con lo reciente.

## Fuera de alcance
- Programar la ejecución (pg_cron, tarea o ruta): despliegue, requiere aprobación.
- Textos legales sobre el identificador derivado de la IP (ítem «Textos legales»).
- Purga de `price_history` (ítem aparte, con su propio procedimiento) y borrado de mesas/organizaciones.
- Anonimizar `client_key` antes de los 30 días (alternativa más fina, no pedida).

## Evidencia
Sobre una base recién reseteada (`pnpm db:reset`, migración `20261015120000`), 2026-10-15; commit: ver Git (`feat: purga de waiter_calls`):
- `pnpm typecheck` y `pnpm lint` OK · `pnpm build` OK · `pnpm test` 254/254.
- `pnpm test:rls` **486/486** en 19 archivos tras las correcciones de la revisión (477 antes); `purga-waiter-calls.rls.test.ts` tiene 29 pruebas: permisos, bordes de 29/31 días, estados, piso y validación (incluidas retenciones mixtas), lotes, idempotencia, convivencia con `create_waiter_call`, concurrencia y bloqueo sostenido y `acl.rls.test.ts` con `purge_waiter_calls: [false, false]`.
- **Mutaciones: 11 defensas rotas de a una, las 11 detectadas** (8 de la primera vuelta; «sin `skip locked`» sobrevivía y ahora se detecta; se suman: piso por comparación de intervalos y sin captura del desborde de fechas). De la primera vuelta: Sin piso (3 fallos), comparación invertida (9), sin límite de lote (1), sin validar el lote (4), sin borrar pendientes (1), ejecutable por `authenticated` (1), sin orden de las más viejas (1). «Sin `skip locked`» sobrevivía hasta la prueba con bloqueo sostenido.
- `pnpm test:e2e` 169/170 en la corrida completa; la falla (`superadmin.spec.ts`, «un email que ya tiene cuenta…») era una carrera del propio test —no esperaba el cierre de sesión del SuperAdmin antes de abrir `/login`, y ahora ese caso redirige a `/admin`—, corregida esperando `/login`; `superadmin` y `acceso` repetidos: 44/44. Esta corrida incluye la tarea S «SuperAdmin sin `next` aterriza en `/admin`» (`aea92a8`, 3 pruebas E2E nuevas).
- No ejecutado: nada contra proyectos remotos; la programación (pg_cron o similar) no existe todavía.

## (C) Invariantes
1. **Ningún rol de la API puede purgar ni borrar:** `purge_waiter_calls` solo la ejecuta `service_role`; los privilegios de la tabla no cambiaron.
2. **Nunca se borra nada con menos de 7 días**, ni por parámetro, ni con valores nulos.
3. **No se pierde un aviso vivo:** lo que la base decide y la sala muestra (≤ 1 h) queda fuera del alcance de la purga.
4. **La purga no bloquea ni falla por concurrencia:** lotes acotados, filas bloqueadas se saltan.
5. **Alcance exacto:** solo `waiter_calls`; ninguna otra tabla, ni `price_history`, ni mesas, ni organizaciones.

## (C) Fallos y recuperación
- **Parámetro inválido:** excepción `22023` antes de tocar datos.
- **Falla a mitad:** cada llamada es una transacción; si falla, no se borra nada de ese lote. Reintentar es seguro (idempotente).
- **Se borró de más (p. ej. alguien la ejecuta con 7 días):** irreversible; solo se recupera de un respaldo de la base, que hoy no está definido. Mitigación: piso, defecto holgado y que solo el servidor pueda ejecutarla. **Antes de programarla en producción hay que definir el respaldo o aceptar explícitamente la pérdida.**
- **Rollback del cambio:** `git revert` + `pnpm db:reset`; en una base con datos, `drop function public.purge_waiter_calls(interval, integer)` y `drop index public.waiter_calls_created_at_idx`.

## (C) Revisión y aprobación
- Revisión independiente (ronda 1, solo lectura, 2026-10-15): **aprobar con cambios**; permisos confirmados (`anon` y `authenticated` no ejecutan ni borran; la función instalada coincide con la migración). Dos hallazgos, ambos corregidos:
  - **Bloqueante — el piso se podía eludir.** PostgreSQL compara un mes como 30 días pero lo aplica por calendario: `1 month -23 days` pasaba la comparación de intervalos y dejaba 5 días efectivos en febrero, y `-4800 months 144007 days` daba un corte en el futuro que alcanzaba llamados recién creados. **Corrección:** la función calcula `v_cutoff = now() - retención`, exige `v_cutoff <= now() - 7 days` y traduce el desborde de fechas a `invalid_retention`. Regresión: 6 casos mixtos/negativos/`-infinity`/desborde (`-4800 months 144007 days` falla sin la corrección). El caso exacto `1 month -23 days` no se fijó porque depende de la fecha (hoy da justo 7 días); se cubre con `1 month -26 days` y `2 months -58 days`.
  - **Importante — `SKIP LOCKED` sin prueba.** Nueva prueba con un bloqueo sostenido de 8 s tomado por otra sesión de `psql`: la purga termina en menos de 4 s, se lleva la fila libre, deja la bloqueada y la borra al liberarse. Quitar `skip locked` ya hace fallar la suite.
  - Falta que el revisor confirme las correcciones (ronda de verificación, sin ampliar el alcance).
- Aprobación del usuario del plazo de 30 días y de programar la ejecución: pendiente.
