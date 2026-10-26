# Cambio: Resumen de la analítica con IA
Estado: implementado y verificado en local; pendiente de la revisión independiente (C), la aprobación del usuario y el despliegue a staging
Nivel: **C** (las cifras de ventas de una organización salen a un servicio externo y se guardan en una tabla nueva; un error de autorización expondría el negocio de un local a otro. «Ante duda, subí un nivel».)

## Objetivo
Que el **Dueño** de un local con plan **Pro o Premium** (función `analytics`) obtenga, con un botón, un resumen en palabras del período que mira en la analítica (7, 30 o 90 días, todas las sucursales o una) con hallazgos y acciones concretas para probar. Idea A + B de la lluvia de ideas del 2026-10-25. Motivos y alternativas: [ADR 0047](../../docs/decisiones/0047-resumen-de-analitica-con-ia.md); el mismo patrón «la IA propone, la persona decide» del [ADR 0046](../../docs/decisiones/0046-sugerencia-de-traducciones-con-ia.md).

## Decisiones
1. **Dónde:** una sección «Resumen con IA» en `/panel/{slug}/analitica`, arriba del resumen numérico. Muestra el último resumen guardado del período y alcance (con fecha y servicio) y el botón «Generar resumen» / «Actualizar resumen». Todo es texto plano; aclara que lo escribió una IA, qué se le envió y que los números exactos están en las secciones de abajo.
2. **Qué se le envía** (`buildFacts`, `src/lib/analitica/resumen.ts`): solo agregados que ya calculó la base y la pantalla (ventas, pedidos, ticket promedio, comparación con el período anterior, mejor día, pedidos por día de la semana y por hora, franjas fuertes, categorías con su porcentaje, los 5 platos que más venden con sus vistas, los 5 que no se piden y cuántos son, cantidades de anulaciones y cancelaciones). **Nunca** los motivos de anulación o cancelación (los escribe el personal y pueden nombrar a un comensal), ni ids, ni personas. Los nombres de platos y categorías viajan como datos, limpios (una línea, sin caracteres de control, hasta 80 caracteres) y las instrucciones dicen que ninguna orden escrita en ellos se obedece.
3. **El modelo redacta, no calcula.** Los porcentajes, el ticket promedio y las diferencias vienen calculados; el prompt prohíbe inventar, sumar o restar cifras y pide cautela con pocos pedidos. Sin período anterior no hay cambio porcentual (`null`) y el texto debe decirlo.
4. **Controles sobre la respuesta** (`validateGenerated`): forma exacta (párrafo ≤ 700 caracteres, hasta 4 hallazgos y 4 acciones con topes), ninguna dirección ni marca (`http`, `www.`, `<`, enlaces markdown), y **ninguna cifra importante inventada**: todo número de tres cifras o más y todo número seguido de «%» tiene que estar en los hechos (los chicos —horas, «3 platos»— no se controlan). Si no pasa, se pide una vez más; si vuelve a fallar, se informa sin guardar nada. Un servicio caído no se reintenta.
5. **Mínimo de pedidos:** con menos de 5 pedidos cerrados en el período no se llama al servicio (no hay nada razonable que resumir) y la pantalla lo explica.
6. **Gasto acotado:** un mismo período y alcance no se regenera antes de 10 minutos (lo controla la acción con la fecha de lo guardado); exige sesión del Dueño con el plan; los pedidos de un resumen son uno (dos si falla un control). Sin tope diario por local (límite aceptado; ver «Fuera de alcance»).
7. **Persistencia:** tabla `analytics_summaries` (migración `20261206100000`), una fila por (organización, sucursal o «todas», período). Se escribe **solo** con `save_analytics_summary` (`SECURITY DEFINER`, `EXECUTE` solo `authenticated`; valida Dueño actual con `analytics`, período 7/30/90 y que la sucursal sea de la organización; `42501` / `22023`). La API no tiene `INSERT`, `UPDATE` ni `DELETE` sobre la tabla, tampoco el servicio técnico. Lee quien pasa `private.can_read_analytics_summary` (Dueño actual con `analytics`; en «solo lectura» sí, suspendida no). La fila se borra en cascada con la sucursal o la organización. Sin datos personales; solo texto ya validado de hasta 8 KB.
8. **Proveedor intercambiable** (`SummaryProvider`): hoy Gemini con la clave gratuita (`GEMINI_API_KEY`, la misma de las traducciones), **solo para datos ficticios**: con esa clave Google puede usar lo enviado para mejorar sus productos. **Antes de usar ventas reales (producción) se pasa a Claude** u otro servicio de pago con otra implementación en `getSummaryProvider()` (decisión del usuario del 2026-10-25) y se anota en el checklist de [producción](../../docs/produccion.md).
9. **Quién:** solo el Dueño (como la analítica). El Staff no entra a la pantalla. Sin límite de plan adicional.

## Aceptación
- [x] Dado un Dueño Pro con al menos 5 pedidos cerrados en el período, cuando pulsa «Generar resumen», entonces ve un párrafo, hallazgos y acciones, con fecha y servicio, y el resumen queda guardado: al volver sigue ahí sin llamar al servicio.
- [x] Dado un resumen recién generado, cuando intenta actualizarlo antes de 10 minutos, entonces recibe un aviso y no se llama al servicio.
- [x] Cada período (7, 30, 90) y cada alcance (todas las sucursales o una) tiene su propio resumen.
- [x] Con menos de 5 pedidos no hay botón y se explica el motivo; el plan Básico no ve la sección; el Staff no entra.
- [x] Nada de lo que escribe el personal en un motivo, ni datos de comensales, sale hacia el servicio (los hechos no contienen motivos).
- [x] Una respuesta con cifras inventadas, direcciones o forma inválida no se guarda (se reintenta una vez; luego aviso).
- [x] Solo el Dueño actual con `analytics` guarda y lee; Staff, Dueño de otro local, sin rol, plan Básico, suspendida y anon no; en «solo lectura» sí. La tabla no admite escrituras directas (ni del servicio técnico).
- [x] 390 px sin desborde.
- [ ] Con la clave real de Gemini: el resumen de un local de prueba se lee bien y no inventa (prueba del usuario en local y en staging).

## Fuera de alcance
Preguntarle a los datos en lenguaje natural (idea C); alertas y resumen semanal automáticos (D); matriz de platos (E); comparar sucursales en narrativa (F); pronósticos; exportar; historial de resúmenes anteriores; tope diario por local; proveedor Claude (siguiente paso, antes de producción); recomendar precios concretos o dar consejo fiscal (el prompt lo prohíbe).

## (C) Invariantes
1. Solo un **Dueño actual** de la organización con `analytics` y la cuenta no suspendida lee o guarda un resumen de ESA organización; cualquier otra identidad, nada (`42501` al guardar, cero filas al leer).
2. Ninguna escritura llega a la tabla por otra puerta que `save_analytics_summary` (ni el Dueño ni el servicio técnico); una sucursal ajena nunca se asocia a una organización (validación de la función y clave foránea compuesta).
3. Al servicio externo solo salen agregados y nombres de platos/categorías ya públicos: ni motivos escritos por el personal, ni ids, ni datos de comensales, ni correos.
4. Lo que se guarda y se muestra pasó la validación (forma, topes, sin direcciones, cifras importantes presentes en los hechos) y se pinta como texto plano.
5. Sin clave configurada, la función queda apagada (no aparece el botón; la acción lo rechaza).

## (C) Fallos y recuperación
- **Servicio caído, lento (40 s de tope) o sin cuota:** la acción informa «No se pudo generar el resumen» y no guarda nada; el resumen anterior sigue visible. Se reintenta a mano.
- **Respuesta que no pasa los controles dos veces:** aviso de confiabilidad, sin guardar.
- **Lectura de ventas caída:** aviso, sin llamar al servicio.
- **Guardado caído después de generar:** aviso («se generó pero no se pudo guardar»); se vuelve a pedir.
- **Rollback:** `git revert`; en una base con datos: `drop function public.save_analytics_summary(uuid, integer, jsonb, text, uuid); drop table public.analytics_summaries; drop function private.can_read_analytics_summary(uuid);` (solo se pierden resúmenes regenerables).

## Evidencia
Ejecutada el 2026-10-26 sobre `main` (base local reseteada con la migración `20261206100000`); el diff probado es el de esta ficha (ver `git log` para el commit).
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK · `pnpm db:types` regenerado.
- Unitarias `pnpm test src/lib`: **969/969**. Nuevas: `resumen.test.ts` (26: hechos sin motivos ni datos personales, comparación sin inventar, franjas, nombres limpios, topes de la respuesta, números permitidos e inventados, direcciones y marcas, reintento y servicio caído) y `proveedor-resumen.test.ts` (clave en el encabezado, solo los hechos como mensaje, error sin repetir el cuerpo, función apagada sin clave).
- RLS `resumen-analitica.rls.test.ts` **9/9** y `acl.rls.test.ts` (declara `can_read_analytics_summary` y `save_analytics_summary`). Encontró un defecto real antes de integrar: la política llamaba a `has_feature`, que la API no puede ejecutar; se envolvió en `private.can_read_analytics_summary`.
- **Mutaciones sobre la migración: 7 defensas rotas de a una (con la base reseteada entre cada una), 7 detectadas:** lectura sin Dueño, lectura sin plan, guardado sin Dueño, guardado sin plan, guardado sin comprobar la sucursal (la detecta el código de error; aun sin la comprobación la clave foránea compuesta la rechaza con `23503`), escritura del servicio técnico y `INSERT` del Dueño por la API.
- E2E `e2e/resumen-analitica.spec.ts` **5/5** con el Gemini de mentira: genera, guarda, no regenera enseguida, un resumen por período y por sucursal, pocos pedidos, plan Básico, Staff; 390 px sin desborde. Capturas a 390 y 1280 px revisadas.
- Suite completa sobre el código final: `pnpm test` **1178/1178**; `pnpm test:rls` **1466/1466** en 68 archivos (base reseteada); E2E `resumen-analitica`, `analitica-pedidos`, `analitica` e `idiomas` **35/35** con `pnpm build` nuevo (borrando `.next` tras el `EPERM` conocido).
- Sin correr todavía: la revisión independiente, la prueba con la clave real de Gemini y el despliegue a staging.
