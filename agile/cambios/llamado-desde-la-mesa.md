# Cambio: Llamado desde la mesa — «Llamar al mozo» y «Pedir la cuenta» desde el QR, con una función de base como única puerta de escritura
Estado: **para verificar** — implementado y probado en la rama `feat/llamado-desde-la-mesa` (sin integrar a `main`); falta la revisión de nivel C por un segundo agente
Nivel: **C** — escritura **pública y sin sesión** sobre datos de un local, que dispara una alerta al personal; el abuso afecta la operación del salón y se guarda un dato derivado de la IP del comensal. Requiere invariantes, pruebas adversarias, mutaciones, revisión de un segundo agente y aprobación humana de los riesgos.

## Objetivo
Que quien escanea el QR de una mesa pueda avisar al personal («Llamar al mozo») o pedir la cuenta con un toque, sin app ni cuenta. El aviso queda registrado de forma atómica y acotada (un pendiente por mesa y tipo, cooldown, límite por cliente) y solo existe si el plan lo incluye y la cuenta está al día. **El panel donde el personal lo ve y lo atiende es el ítem siguiente («Panel de sala»)**; acá se construye el dato, la regla y el botón del comensal.

## Decisiones (de `docs/producto.md`, `docs/arquitectura.md` y ADR 0006/0009; las marcadas *revisable* son interpretaciones mías)
1. **Quién llama:** cualquiera con el token de una mesa (anónimo, sin sesión). **La única puerta de escritura es la función de base `public.create_waiter_call(p_token, p_kind, p_client)`** (`SECURITY DEFINER`, `search_path` vacío, valida todo adentro). Ningún rol de la API (ni `anon` ni `authenticated`) tiene `INSERT`, `UPDATE` ni `DELETE` sobre `waiter_calls`.
2. **Tipos:** `waiter` («Llamar al mozo») y `bill` («Pedir la cuenta»).
3. **Disponibilidad:** el llamado existe solo si la mesa está **activa y no silenciada**, la organización activa y `private.has_feature(org, 'waiter_call')` (plan Pro o superior **y** cuenta en `active`/`grace`; en solo lectura y suspendida las funciones interactivas se apagan, ADR 0006). Cualquier otra situación responde un único `unavailable` **sin revelar la causa** (plan, mora, silencio o mesa inactiva).
4. **Resultados** (la función devuelve un `jsonb {status, …}` y no lanza errores en los flujos normales): `created`, `already_pending`, `cooldown` (con `retry_after_seconds`), `rate_limited` (con `retry_after_seconds`), `unavailable` y `not_found` (token malformado o desconocido, mismo resultado; kind inválido también es `not_found`).
5. **Un pendiente por (mesa, tipo)**, resuelto en la base: índice único parcial `(table_id, kind) where status = 'pending'` y *advisory lock* por mesa, para que dos toques simultáneos no creen dos. Reintentar con uno pendiente devuelve `already_pending` («ya te avisamos») y **no** inserta.
6. **Vencimiento a los 30 minutos, derivado** (como la mora): no hay proceso programado. Antes de decidir, la función marca `expired` los pendientes de esa mesa con más de 30 min (así un pendiente viejo no bloquea el índice único para siempre). El panel de sala debe tratar como vencido todo pendiente con más de 30 min aunque nadie haya llamado de nuevo.
7. **Cooldown de 60 s *por mesa y tipo*** *(revisable)*, configurable por sucursal (`branches.waiter_call_cooldown_seconds`, 10 a 3600, por defecto 60; sin UI todavía), contado desde la **creación** del llamado anterior del mismo tipo aunque ya esté atendido. `producto.md` dice «entre llamados de la misma mesa»; lo apliqué por tipo para que pedir la cuenta pocos segundos después de llamar al mozo no se bloquee, y cada tipo sigue acotado a un llamado por minuto.
8. **Límite por cliente** *(decisión del usuario, 2026-10-14: función abierta a `anon` + identificador de cliente como parámetro)*: como máximo **30 llamados nuevos cada 10 minutos por identificador de cliente**, sumando todas las mesas → `rate_limited`. El identificador lo arma el servidor de la app: **HMAC-SHA256 de la IP** con un secreto de servidor (`WAITER_CALL_CLIENT_SECRET`; si falta, un secreto efímero por proceso), truncado a 32 hex. **La IP en claro no se guarda ni se registra en ningún lado.** El tope es **generoso a propósito**: muchas mesas comparten el Wi-Fi del local y por lo tanto la IP. Es una defensa de segunda línea: quien llame a la API directamente puede cambiar ese valor; el tope duro por mesa es el cooldown más el pendiente único, y hace falta un token de mesa (122 bits).
9. **Dato guardado:** `waiter_calls` (organización, sucursal, mesa, tipo, estado `pending | attended | expired`, `created_at`, `attended_at`, `attended_by`, `client_key`). Clave foránea compuesta a la mesa, la sucursal y la organización. Los miembros del local **leen** los llamados de **su** organización (RLS); «marcar atendido» y su política de `UPDATE` llegan con el panel de sala.
10. **Columnas nuevas sin UI:** `tables.muted_until` (silenciar una mesa; el cambio llega con «Configuración del llamado») y `branches.waiter_call_cooldown_seconds`. Ninguna es escribible por la API todavía.
11. **Entrada del comensal (`/t/{token}`):** una barra fija inferior con «Llamar al mozo» y «Pedir la cuenta», **solo si** `resolve_table_qr` informa `calls_enabled` (se agrega ese booleano: mesa activa, no silenciada y función habilitada). Una *server action* sin sesión calcula el identificador de cliente y llama a la función con el cliente `anon` (**sin `service_role`**); muestra el resultado en un mensaje accesible. Sin tiempo real para el comensal: la confirmación es la respuesta.
12. **No incluye** (ítems propios): panel de sala y «atendido» (con su política), difusión en tiempo real, UI para silenciar una mesa o cambiar el cooldown, purga por antigüedad, estado posterior para el comensal («ya te atendieron»).

## Comportamiento y aceptación
- [x] Mesa activa de un local Pro al día: «Llamar al mozo» → `created`, queda **un** llamado `pending` de tipo `waiter` en la sucursal y organización de esa mesa. «Pedir la cuenta» es independiente y también se crea.
- [x] Segundo toque del mismo tipo con uno pendiente → `already_pending` y no se inserta nada; dos toques simultáneos (también 10 en paralelo) dejan exactamente **un** pendiente.
- [x] Tras atenderse (o vencer), un nuevo llamado del mismo tipo antes de los 60 s → `cooldown` con los segundos restantes; pasado el cooldown → `created`. El cooldown de la sucursal es el configurado.
- [x] Un pendiente de más de 30 min se marca `expired` al llamar de nuevo y no bloquea.
- [x] Plan Básico, cuenta en solo lectura o suspendida, mesa inactiva, mesa silenciada u organización inactiva → `unavailable` (idéntico, sin causa); en gracia funciona. Sin esas condiciones **no se muestran los botones**; si alguien fuerza la acción, el resultado es `unavailable` y no hay filas nuevas.
- [x] Token inexistente, malformado, de un QR regenerado o tipo inválido → `not_found` (idéntico, sin pistas).
- [x] Con 30 llamados del mismo identificador en 10 min, el siguiente → `rate_limited`; otro identificador, o ninguno, no se ve afectado.
- [x] El comensal ve un mensaje claro por cada resultado; sin desborde a 390 px; los botones son de 44 px como mínimo y accesibles por teclado.
- [x] El navegador del comensal **nunca** recibe ids, el token de otra mesa ni el identificador de cliente; el cliente guarda solo el hash (no la IP) en `client_key`.
- [x] `anon` y `authenticated` **no** pueden leer (salvo miembros de su organización), insertar, modificar ni borrar `waiter_calls` por la API; un miembro de otra organización no ve los llamados ajenos.
- [x] `resolve_table_qr` agrega `calls_enabled` y sigue devolviendo lo mínimo (sin ids ni token).

## Alcance / fuera de alcance
- Incluye: migración (`waiter_calls`, columnas nuevas, índices, RLS, permisos, función `create_waiter_call`, `resolve_table_qr` con `calls_enabled`); módulo `src/lib/llamados` (identificador de cliente, IP, mensajes, lectura del resultado); barra de llamado en `/t/{token}` y su *server action*; `.env.example`; pruebas (unitarias, base, E2E) y mutaciones; ADR 0010; docs, tablero y handoff; ajustes de `acl.rls.test.ts` y `database.types.ts`.
- No incluye: ver el punto 12.

## Dependencias y riesgos
- **Escritura pública sin sesión (riesgo principal):** acotada por token (122 bits), cooldown, un pendiente por tipo y límite por cliente; **el límite por cliente se puede eludir llamando a la API directo** con valores distintos. Un QR fotografiado de varias mesas permite como mucho un aviso por minuto y tipo por mesa; se mitiga con regenerar el QR y silenciar la mesa (cuando exista la UI).
- **Wi-Fi compartido:** todos los comensales del local salen por la misma IP; por eso el tope por cliente es de 30 cada 10 min y no más bajo. Un tope más estricto bloquearía a clientes legítimos.
- **Dato personal derivado:** `client_key` es un HMAC de la IP (no reversible sin el secreto, no es la IP). Se conserva hasta que exista la purga (ítem posterior; propuesta: 30 días). Debe figurar en los textos legales (ley 25.326) cuando se redacten.
- **Secreto de servidor nuevo (`WAITER_CALL_CLIENT_SECRET`):** sin él se usa uno efímero por proceso: el límite funciona dentro de cada instancia pero no entre instancias ni tras reinicios. Debe definirse en producción (checklist de «Salida a producción»). No es una credencial de acceso a datos.
- **IP del pedido detrás de un proxy:** se toma la primera de `x-forwarded-for` (o `x-real-ip`); la confiabilidad depende del hosting. Si no hay IP, no se aplica el límite por cliente (igual rigen el cooldown y el pendiente único).
- **Sin retención ni purga** de `waiter_calls`: crece con el uso; acotado por el cooldown (máximo ~2.900 filas por día por mesa). Ítem posterior.
- **Comensal sin estado posterior:** no sabe si ya lo atendieron; solo recibe la confirmación del envío.
- **Función `SECURITY DEFINER` pública:** entra a la matriz de `acl.rls.test.ts`; salida mínima; sin ids.

## Evidencias de verificación
Ejecutadas el 2026-10-14 sobre una base recién reseteada (`pnpm db:reset`, migración `20261014050902_waiter_calls.sql`) y con el build hecho sobre el código final:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK.
- `pnpm test` **123/123** (16 nuevas en `src/lib/llamados/llamados.test.ts`: identificador de cliente con **vectores fijos** y sin la IP, IP del pedido con cabeceras hostiles, lectura de resultados que falla cerrado, mensajes que no revelan la causa y `placeCall` con el registro de errores sin token ni identificador).
- `pnpm test:rls` **308/308** en 12 archivos (286 → 308): `waiter-calls` (22: crear, tipos independientes, `already_pending`, **60 llamados paralelos** de la misma mesa y tipo con un solo pendiente y ningún error, índice único, cooldown y el configurado por sucursal, vencimiento a los 30 minutos con casos de 29 y 31, disponibilidad —Básico, solo lectura, suspendida, mesa inactiva y silenciada— con un `unavailable` idéntico, `not_found` idéntico para 13 entradas hostiles, límite por cliente de 30 cada 10 minutos, identificador inválido, acceso directo a la tabla por `anon` y `authenticated`, aislamiento entre locales, clave compuesta, *checks* y cascadas, y `calls_enabled`). `acl` y `tables` ajustadas.
- `pnpm test:e2e` **104/104** (86 previas + 18 de llamados a 390 px). En siete corridas completas de esta etapa: cuatro con 104/104, dos con una falla aislada (una prueba de contraseña de la sección «Mi cuenta», anterior a este ítem, que esperaba una confirmación de 5 s con la máquina cargada, y un *worker* de Playwright caído con `0xC0000409`) y una con 104/104 tras subir el tiempo de las aserciones a 10 s. Cubre: botones, confirmación, `already_pending`, tipos independientes, cooldown con los segundos y luego creación, doble clic, dos celulares a la vez, la barra que no tapa el final de una carta larga, objetivos táctiles de 44 px, Básico/solo lectura/suspendida/mesa inactiva/silenciada/QR regenerado sin botones, **seis cambios de estado con la pantalla ya abierta** (la base responde «no disponible» con el mismo mensaje y no crea nada), identificador de cliente estable por IP y **la IP nunca en ninguna columna**, sin IP válida sin identificador y el límite de 30 con un mensaje claro y otra conexión sin afectar.
- **Mutaciones: 45 defensas rotas de a una, 43 detectadas y 2 equivalentes.** Función y base (32, 30 detectadas): sin validar tipo, organización inactiva, mesa inactiva, silencio, plan y mora, vencimiento (ausente y a 20 minutos), chequeo de pendiente, **sin lock por mesa** (con la prueba de 60 paralelos), límite por cliente (ausente, 31 y ventana de 15 minutos), cooldown (ausente, por mesa en vez de por tipo y fijo en 60 s), identificador sin validar, causa revelada, función sin `SECURITY DEFINER` o sin `search_path`, permisos y políticas abiertas para `anon`/`authenticated` (insertar, leer, modificar, borrar), lectura sin membresía, sin índice único, sin clave compuesta, sin *check* del identificador, `calls_enabled` fijo y `anon` sin `EXECUTE`. Módulo y pantalla (13, todas detectadas): `placeCall` sin validar, identificador igual a la IP, IP sin validar, resultado desconocido leído como creado, secreto sin mínimo, registro con el token, mensaje que revela el plan, redondeo de minutos, `p_client` forzado, botones ofrecidos sin `calls_enabled`, acción sin identificador, errores como estado en vez de alerta y barra que tapa la carta.
  - *Equivalentes:* (1) la función sin validar el formato del token: un texto cualquiera no coincide con ningún token; (2) sin el manejador de violación de unicidad pero con el lock: el lock vuelve inalcanzable ese camino (el manejador es un respaldo).
  - Una **sobrevivía** al principio y se resolvió: «sin lock por mesa» no se detectaba con 20 llamados paralelos; con 60 sí (aparece un resultado `cooldown` que el lock evita). Otra era una prueba floja de la pantalla: con una carta corta la barra no tapaba nada aunque faltara el margen; ahora la carta es larga.
- Revisión visual a 390 px: barra fija con dos botones, mensaje de confirmación y de «no disponible» (en rojo, sin revelar la causa).
- Sin residuos: 0 organizaciones `tt-*`/`e2e-*`, 0 usuarios `e2e-*`/`rls-*` y 0 filas en `waiter_calls` (se limpiaron a mano los de `limits.rls`, ver «Aprendizajes»).

Pendientes (no ejecutado):
- **Revisión de nivel C por un segundo agente (Codex, solo lectura): no pedida todavía.**
- Probar la barra en un teléfono real (Safari/iOS y Android, teclado y *safe area*), lector de pantalla, `pnpm dev` de punta a punta y la IP real detrás del hosting de producción (`x-forwarded-for`).
- Definir `WAITER_CALL_CLIENT_SECRET` en producción; purga de `waiter_calls`; textos legales sobre el identificador derivado de la IP.

## Aprendizajes / cambios de decisión
- **El usuario eligió el límite por IP como parámetro con la función abierta a `anon`** (frente a cerrarla y usar `service_role`, o no limitar por IP). Queda escrito como riesgo aceptado: se puede eludir llamando a la API directo.
- **El límite por cliente cuenta en todos los locales** (el identificador es por conexión, no por mesa): mis primeras pruebas reutilizaban el mismo identificador y se contaminaban entre sí; ahora cada prueba usa uno propio.
- **«Sin lock por mesa» no se detectaba con 20 llamados paralelos** porque la carrera es corta en local. Con 60 aparece un `cooldown` que el lock evita y la mutación se detecta; el manejador de unicidad queda como respaldo (si el lock faltara, el resultado seguiría siendo `already_pending` o `cooldown`, nunca dos pendientes ni un error).
- **El vencimiento a los 30 minutos es derivado:** hay que marcar `expired` los pendientes viejos antes de decidir, porque el índice único parcial los seguiría contando y bloquearía la mesa para siempre.
- **El cooldown quedó por mesa y tipo** (interpretación mía de «entre llamados de la misma mesa», marcada *revisable*) para que pedir la cuenta tras llamar al mozo no se bloquee.
- **Una carta corta esconde un margen faltante:** la prueba de que la barra no tapa el final no detectaba nada hasta que se la hizo con una carta que hace scroll.
- **Los botones dependen de `calls_enabled`, pero la autoridad es la base:** seis pruebas cambian el estado con la pantalla ya abierta y el resultado es siempre el mismo «no disponible».
- **Entorno del usuario:** con `NEXT_PUBLIC_SITE_URL` definida en el shell (para probar el QR en el celular) fallaban dos pruebas unitarias de `mesas` (pasaban `undefined` y se activaba el valor por defecto) y la de la hoja imprimible (esperaba `localhost:3100`). Se corrigieron para que valgan con y sin la variable; se comprobó con y sin ella, reconstruyendo, porque Next la fija al compilar.
- **Trabajo en paralelo de otros agentes:** existen los *worktrees* `UcoMenu-carta` (`feat/diseno-carta`) y `UcoMenu-precios` (`feat/historial-precios`); el de la carta toca los mismos componentes públicos que la barra del llamado. Se dejó anotado en `agile/ahora.md`; no se tocó nada de ellos.
- **Estabilidad del E2E:** con ~100 pruebas en paralelo la máquina a veces tarda más de 5 s en acciones del servidor; las aserciones pasaron a esperar 10 s (`playwright.config.ts`). Siguen apareciendo, aislados, los *workers* caídos con `0xC0000409` de Windows. En una corrida previa de la suite completa se vio una falla en masa que no se pudo explicar ni reproducir; se descartó un límite de tasa de Auth (sin respuestas 429 en el registro).
- **RLS:** una corrida completa dejó 40 organizaciones `tt-per-*` del archivo de personal sin limpiar y rompió un par de pruebas de lectura pública por eso; no se reprodujo en las tres corridas siguientes (308/308). Se limpió a mano. Sigue sin corregirse la fuga preexistente de `limits.rls.test.ts`.

## (C) Invariantes
1. **Una sola puerta de escritura:** ningún rol de la API inserta, modifica ni borra `waiter_calls`; solo `create_waiter_call` (definer) escribe, y solo la fila que corresponde a una mesa **resuelta por su token**.
2. **Como máximo un llamado `pending` por (mesa, tipo)**, también bajo concurrencia (índice único parcial + lock por mesa).
3. **Un llamado siempre pertenece a la misma organización, sucursal y mesa** (clave foránea compuesta): el token de una mesa nunca crea un llamado en otro local.
4. **Sin el plan y sin la cuenta al día no se crean llamados** (`has_feature`), ni con la mesa inactiva o silenciada ni con la organización inactiva; la respuesta no distingue la causa.
5. **Las respuestas no filtran información de otros locales ni de otras mesas** (sin ids, sin tokens, `not_found` idéntico).
6. **La IP del comensal no se guarda en claro** en ninguna tabla, registro ni respuesta.
7. Un pendiente vencido (más de 30 min) nunca bloquea un llamado nuevo.

## (C) Fallas y manejo de errores
- Token o tipo inválido, mesa inexistente: `not_found`, sin excepción.
- Base no disponible o error inesperado en la acción: mensaje genérico al comensal («Por ahora no se puede avisar desde acá. Levantá la mano o buscá al personal.»); el error se registra en el servidor sin IP ni token.
- Dos toques simultáneos: el lock por mesa los serializa; el segundo ve el pendiente y responde `already_pending`.
- Doble envío del formulario (doble clic): el botón se deshabilita mientras se envía y la base ya es idempotente por tipo.
- Respuesta de la función con una forma inesperada: la acción la trata como «no disponible» (falla cerrado).
- Reintentos: cualquier reintento tras `created` da `already_pending`; tras `cooldown`/`rate_limited` el mensaje dice cuánto esperar.

## (C) Seguridad y permisos
| Actor | `create_waiter_call` | Leer `waiter_calls` | Modificar / borrar |
| --- | --- | --- | --- |
| Anónimo con token de mesa | sí, acotado | no | no |
| Miembro (Dueño/Staff) | sí (es público) | solo los de su organización | no (llega con el panel de sala) |
| Miembro de otra organización | sí con **su** token de mesa; nunca sobre otro local | no ve los ajenos | no |
| `service_role` | todo (servidor) | todo | todo |

Amenazas: flooding con un token fotografiado; recorrer tokens (122 bits); saltarse el límite por cliente llamando a la API directo; forjar organización o sucursal; condición de carrera para duplicar pendientes; bloqueo permanente por un pendiente viejo; filtrar planes o mora por la respuesta; guardar la IP en claro; inyección en `p_client` o `p_token`.

## (C) Migración y rollback
- **Migración aditiva:** tabla nueva, dos columnas nuevas con valor por defecto (`tables.muted_until` nula, `branches.waiter_call_cooldown_seconds` = 60), una restricción única en `tables`, una función nueva y `resolve_table_qr` reemplazada (agrega una clave). No toca datos existentes. Solo local; **nada contra proyectos remotos**.
- **Rollback (local):** `git revert` + `pnpm db:reset`. En una base con datos: `drop function public.create_waiter_call(text, text, text)`, `drop table public.waiter_calls`, quitar las dos columnas y la restricción, y volver a crear `resolve_table_qr` de la migración anterior.

## (C) Aceptación explícita del riesgo
- El usuario pidió esta tarea el 2026-10-14 y **eligió el límite por IP como parámetro con la función abierta a `anon`** (aceptando que se puede eludir llamando a la API directo) frente a cerrar la función y usar `service_role` en la ruta pública. La interpretación del cooldown por tipo y el tope de 30 por 10 minutos son míos y quedan para su confirmación. Revisión de nivel C por un segundo agente (Codex, solo lectura): _pendiente_.
