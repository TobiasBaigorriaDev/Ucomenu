# Cambio: Ticket de visita — una pestaña vieja de `/t/{token}` deja de poder avisar, y la sala ve cuánto hacía que el comensal había escaneado
Estado: **integrado** a `main` por squash merge y subido a GitHub (2026-10-14) tras la revisión de Codex en solo lectura sobre `bda19f4`: *aprobar*, sin defectos funcionales en los 26 archivos; la rama `feat/ticket-de-visita` (parte de `61086b2`) se conserva
Nivel: **M** (toca la puerta de escritura pública `create_waiter_call` y agrega una columna; no toca dinero, permisos de terceros ni datos existentes)

## Objetivo
Mitigar el riesgo documentado en ADR 0009 y 0010: un comensal que se fue conserva la pestaña abierta (o la recupera del historial) y toca «Llamar al mozo» o «Pedir la cuenta» desde su casa, generando alertas falsas en `/sala`. Elegido por el usuario entre varias alternativas (A + D1 del análisis): **A**, un ticket de visita con vencimiento, y **D1**, mostrar al mozo la antigüedad del escaneo.

## Alternativas consideradas (resumen; el análisis completo está en la conversación del 2026-10-14)
- **A. Ticket de visita con TTL** — *elegida.* Sin fricción para quien está en la mesa, sin permisos ni cuentas, casi sin base de datos.
- **B1. Cerrar la sesión al atender «Pedir la cuenta»** — pospuesta: cubre la salida real pero depende de A (hay que tener tickets que invalidar) y de que se pida la cuenta.
- **B2. «Liberar mesa» manual** — descartada: si el mozo olvida abrir o liberar, bloquea a clientes legítimos (peor que el problema).
- **C. Geolocalización al tocar** — descartada: permiso invasivo en el peor momento, GPS impreciso adentro, falseable, choca con la postura de privacidad (`arquitectura.md`: «UcoMenu no rastrea la ubicación») y suma datos personales (ley 25.326).
- **D2 IP del Wi-Fi del local** (la mayoría usa datos móviles), **D3 horario de atención**, **D4 QR dinámico o PIN**: descartadas.

## Decisiones (las del usuario son «A + D1 con la recomendación»; los valores marcados *revisable* son los que propuse y no se objetaron)
1. **Ticket sin estado, firmado por el servidor:** `<segundos de emisión>.<HMAC-SHA256(secreto, "visit:" + token + ":" + segundos)>` truncado a 32 hex. Se emite **en cada carga** de `/t/{token}` (la página es dinámica; nunca desde caché), va en un campo oculto de la barra del llamado y atado al token de **esa** mesa (uno de otra mesa no sirve). Reutiliza `WAITER_CALL_CLIENT_SECRET` (con otro prefijo de dominio).
2. **Plazo de 3 horas** desde que se abre la carta *(revisable; constante `VISIT_TTL_MS`)*. Una sobremesa más larga vuelve a escanear.
3. **Se valida en la app, no en la base** *(propuesta, no objetada)*: la *server action* rechaza un ticket ausente, ilegible, falsificado, de otra mesa, del futuro (más de 1 minuto) o vencido, con **el mismo mensaje** para todos los motivos («Esta sesión venció. Escaneá de nuevo el QR de tu mesa para avisar al personal.») y **sin llegar a la base**. Quien llame a la función de base directo se lo salta: es el mismo riesgo ya aceptado para el límite por cliente (ADR 0010).
4. **La barra se apaga sola:** pasado el plazo desde que se montó (con el reloj del dispositivo: solo transcurre tiempo, no depende de que esté en hora) los botones se reemplazan por el aviso de volver a escanear, y también si la pestaña vuelve a primer plano (`visibilitychange`, `pageshow`, `focus`), porque los celulares congelan los temporizadores con la pantalla apagada. Es cortesía: el servidor valida igual.
5. **D1, antigüedad del escaneo para el mozo:** `waiter_calls.visit_started_at` (informativo; `NULL` si falta). La app manda la hora de emisión del ticket como `p_visit_started_at` y **la base solo la guarda si es verosímil** (de las últimas 24 horas y no más de 1 minuto en el futuro; si no, `NULL`); no decide nada con ella. La tarjeta de la sala muestra «Escaneó el QR *2 h 40 min* antes del aviso» (intervalo entre el escaneo y el llamado) y, desde **2 horas** *(revisable)*, agrega «Hace mucho: confirmá que siga en la mesa». Sin dato (llamados hechos por la API directo, o anteriores), no muestra nada.
6. **Sin «Descartar (falso aviso)»** *(propuesta, no objetada)*: solo el dato. Un estado nuevo queda para un incremento aparte si hace falta.
7. **`create_waiter_call` cambia de firma** (4.º parámetro `p_visit_started_at`, con valor por defecto): se **reemplaza** la función (un *overload* dejaría dos puertas); las llamadas con 3 argumentos siguen valiendo. El resto de la función es idéntico (mismas reglas y resultados).

## Comportamiento y aceptación
- [x] Recién escaneado, el comensal llama con normalidad y la base guarda `visit_started_at` ≈ la hora de apertura.
- [x] Pasadas 3 horas con la pestaña abierta (reloj simulado), los botones desaparecen, aparece el aviso (`role="status"`) y no se crea nada; vuelve a mirarse al recuperar el foco; con 2 h 59 min todavía están.
- [x] Con la pestaña mostrando los botones pero un ticket vencido, de otra mesa, ausente, retocado o inventado, la acción responde el mismo aviso, la barra pasa al estado vencido y **no queda ninguna fila**; un ticket de hace casi 3 horas todavía sirve.
- [x] Recargar emite un ticket nuevo y permite llamar (**límite conocido y aceptado**, ver «Dependencias y riesgos»).
- [x] La sala muestra la antigüedad del escaneo (40 min sin advertencia; 2 h 40 min con la advertencia; sin dato, nada), también de punta a punta (llamado real desde la carta → «Escaneó el QR N s antes del aviso»), sin desborde a 390 px.
- [x] `visit_started_at` se guarda solo si es verosímil (ausente, de hace más de 24 h o del futuro → `NULL`), no rompe el llamado y **no cambia ninguna regla** (cooldown, pendiente único, disponibilidad); la API no la escribe ni la inserta; existe una sola `create_waiter_call`.
- [x] La ruta de consulta de la sala devuelve `visitStartedAt` (instante o `null`) y nada más sobre el comensal.

## Alcance / fuera de alcance
- Incluye: migración `20261014200000_ticket_de_visita.sql`; `src/lib/llamados/visit-ticket.ts`; `place-call.ts`, `result.ts`; acción, barra y página de `/t/{token}`; sala (tipos, lectura y tarjeta); secreto fijo en `playwright.config.ts` para las pruebas; pruebas (unitarias, de base, E2E) y mutaciones; ADR 0010 enmendada; `producto.md`, `arquitectura.md`, `.env.example`, tablero y handoff.
- No incluye: cerrar la sesión al atender la cuenta (B1) ni «Liberar mesa» (B2); geolocalización; «Descartar (falso aviso)»; validar el ticket en la base; renovar el ticket por actividad.

## Dependencias y riesgos
- *(Superado el 2026-10-25: la visita vive en la URL y recargar la reutiliza; ver la [ficha de turno de mesa](turno-de-mesa.md) y el ADR 0044, enmienda 2.)* **Recargar renueva el ticket** (no se puede distinguir un escaneo de una recarga con un QR estático y un comensal anónimo): quien recargue la URL desde el historial puede seguir avisando. Para eso solo sirven B2 o GPS (descartados por costo). Se mitiga con D1: el mozo ve cuánto hacía que había escaneado, y los topes de ADR 0010 siguen rigiendo (un pendiente por mesa y tipo, cooldown, 30 avisos cada 10 minutos por conexión).
- **Solo la app valida:** quien llame a la API directo con el token de la mesa evita el ticket (y puede mandar cualquier `p_visit_started_at`, que por eso es solo informativo y está acotado).
- **`WAITER_CALL_CLIENT_SECRET` deja de ser opcional en producción:** con el secreto efímero por proceso, los tickets emitidos por una instancia no valen en otra ni tras un reinicio, y un comensal legítimo vería «Esta sesión venció» sin motivo. Va al checklist de «Salida a producción». Falla cerrado a propósito (distinto del límite por cliente, que falla abierto).
- **Una sobremesa de más de 3 horas** vuelve a escanear (el QR está en la mesa).
- **Reloj del dispositivo:** el plazo del cliente cuenta tiempo transcurrido, no hora absoluta; el del servidor usa su propio reloj. Un salto grande del reloj del dispositivo solo adelanta o atrasa el aviso de cortesía.
- **Dato derivado de la IP:** sin cambios respecto de ADR 0010. `visit_started_at` no es dato personal (un instante).

## Evidencias de verificación
Ejecutadas el 2026-10-14 sobre una base reseteada con la migración nueva (`pnpm db:reset`) y `pnpm build` sobre el código final:
- `pnpm typecheck` OK · `pnpm exec eslint src e2e tests playwright.config.ts` OK (el `pnpm lint` global falla por scripts sin seguimiento de `output/`, ya anotado en el tablero) · `pnpm build` OK.
- `pnpm test` **199/199** (187 → 199: 7 de `visit-ticket.test.ts` —emisión, vigencia y bordes, vencimiento, otra mesa/secreto/hora retocada, futuro y tolerancia, valores raros—, 4 de la sala —antigüedad, umbral de 2 horas, duración sin «hace», lectura opcional— y 1 de `placeCall`).
- `pnpm test:rls` **392/392** en 16 archivos (386 → 392): `waiter-calls` (+5: se guarda lo verosímil, valores imposibles → `NULL` sin romper el llamado, no cambia ninguna regla, la API no escribe la columna, una sola función) y `sala-module` (+1). `acl` sin cambios.
- `pnpm test:e2e` **138/138** (129 → 138: 9 de `ticket-de-visita.spec.ts`, a 390 px, con reloj simulado y tickets firmados con el secreto de pruebas); se ajustó una aserción existente de `sala.spec.ts` (la ruta de consulta ahora devuelve también `visitStartedAt`). De cuatro corridas completas, tres con 138/138 y una con **una falla aislada en `mesas.spec.ts`** (anterior a este ítem, no capturada; la repetición pasó).
- **Mutaciones: 30 defensas rotas de a una y 30 detectadas.** Base (5): valor sin acotar, ventana de 400 días, futuro lejano, no guarda el valor, borde del futuro sin tolerancia. Módulo y sala (14): sin vencimiento, borde inclusivo, plazo de 4 h, firma sin comparar, firma sin la mesa, firma sin la hora, sin rechazar el futuro, tolerancia de 1 h, ticket ausente aceptado, forma sin validar, `placeCall` sin la visita, signo invertido, umbral de 1 h y lectura que exige el dato. Acción y pantallas (11, con build y E2E): acción sin verificar, sin mandar la visita, barra que ignora el rechazo, sin temporizador, sin revisar al volver, sin ticket en el formulario, botones tras vencer, ticket de otra mesa, sala que nunca advierte y que no muestra el escaneo. (La primera versión de «acción sin verificar» no compilaba; se rehízo con una variante que sí.)
- Sin residuos: 0 organizaciones `tt-*`/`e2e-*`.

Pendientes (no ejecutado):
- ~~Revisión de un segundo agente (Codex, solo lectura)~~ **Hecha: aprobar** sobre `bda19f4`.
- Probar en un teléfono real: pantalla apagada más de 3 horas y volver a la pestaña (los navegadores móviles congelan o descartan pestañas; en un descarte la recarga emite un ticket nuevo), y la tarjeta de la sala en el salón.
- Definir `WAITER_CALL_CLIENT_SECRET` en producción.

### Investigación en teléfono real — 2026-10-20
- El usuario observó que Android ocultó los botones después de 3 horas e iPhone los mantuvo visibles. Confirmó que **no intentó llamar** desde el iPhone: no se verificó que aceptara un ticket vencido.
- Revisión sobre `48604ae` (sin cambios funcionales): la barra comprueba `Date.now()` desde el montaje, con temporizador y eventos `visibilitychange`, `pageshow` y `focus`; la acción valida el ticket con el reloj del servidor antes de llegar a la base. Cada carga de la página emite otro ticket. Una recarga automática al recuperar la pestaña **podría** explicar la diferencia; no se confirmó que ocurriera en ese teléfono. Es el límite de renovación ya aceptado, no una regla distinta por sistema operativo.
- Verificación: `pnpm test src/lib/llamados/visit-ticket.test.ts src/lib/llamados/place-call.test.ts` ejecutó **7/7** de `visit-ticket` (no existe un archivo separado `place-call.test.ts`); `pnpm test src/lib/llamados/llamados.test.ts` **18/18**, incluida la cobertura de `placeCall`. Estas unitarias no prueban la barra ni la acción completa. Las E2E existentes cubren vencimiento, retorno y rechazo del servidor, pero la configuración solo ejecuta Chromium.
- No se ejecutaron E2E, RLS ni pruebas en Safari/iPhone durante esta investigación. Para cerrar el diagnóstico: comprobar el resultado de tocar el botón después del plazo **sin recargar** y distinguir si el navegador conservó o volvió a cargar la página. No se cambió la renovación del ticket.

## Aprendizajes / cambios de decisión
- **El ticket no resuelve «lo abre desde el historial»**: recargar lo renueva. Quedó dicho antes de elegir y es la razón de D1; solo B2 o GPS lo cierran de verdad.
- **Falla cerrada con el secreto efímero:** a diferencia del límite por cliente, un ticket que no se puede verificar bloquea al comensal; por eso el secreto pasa a ser requisito de producción.
- **Probar el servidor con tickets firmados:** el servidor de pruebas usa un secreto fijo (`playwright.config.ts`, solo para pruebas) y las pruebas importan `issueVisitTicket` para fabricar tickets vencidos o de otra mesa; la prueba con reloj simulado solo cubre la parte del navegador.
- **`pnpm db:types`** regenera `database.types.ts` con un espacio de más en un punto ajeno (ruido del generador); se dejó tal cual porque el cambio real (el parámetro y la columna) va en el mismo archivo.

## (C-lite) Migración y rollback
- Aditiva: una columna nullable y el reemplazo de una función por otra con un parámetro más (con valor por defecto). No toca datos existentes. Solo local; **nada contra proyectos remotos**.
- **Rollback (local):** `git revert` + `pnpm db:reset`. En una base con datos: `drop function public.create_waiter_call(text, text, text, timestamptz); alter table public.waiter_calls drop column visit_started_at;` y volver a crear la función con la definición de `20261014050902_waiter_calls.sql`.
