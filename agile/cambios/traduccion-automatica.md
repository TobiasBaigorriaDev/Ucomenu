# Cambio: Sugerencia de traducciones con IA
Estado: implementado, verificado en local y probado por el usuario con la clave real de Gemini (2026-10-25: «funciona excelente»); en staging (Fly v55, 2026-10-26)
Nivel: M (un servicio externo recibe los textos de la carta; sin permisos, dinero, borrados ni datos personales ni esquema nuevo; ver «Nivel»)

## Objetivo
Que el Dueño y el Staff completen de una vez las traducciones de la carta (`/panel/{slug}/carta/traducciones`) con una sugerencia automática, que revisan y guardan como siempre. Motivos y alternativas: [ADR 0046](../../docs/decisiones/0046-sugerencia-de-traducciones-con-ia.md); es el «incremento posterior» previsto en el [ADR 0023](../../docs/decisiones/0023-carta-en-varios-idiomas.md).

## Decisiones
1. **Sugerir, no publicar.** El botón «Sugerir con IA lo que falta en {idioma}» pide al servidor la traducción de lo que falta y la escribe **solo en los campos que siguen vacíos** del formulario (nunca pisa lo escrito). No guarda: los campos sugeridos se resaltan hasta que se editan o se guarda; el local pulsa «Guardar» como hoy, con los mismos topes y el mismo `CHECK`.
2. **Alcance:** toda la carta de una vez (categorías, platos y descripciones, grupos y opciones, también lo oculto), hasta 300 textos por clic en tramos de 40; si queda algo sin sugerencia, otro clic lo completa. Un tramo que falla no pierde los anteriores.
3. **Proveedor intercambiable** (`TranslationProvider` en `src/lib/idiomas/sugerir.ts`). Hoy **Gemini** (`gemini.ts`, `fetch` directo, salida JSON con esquema, instrucciones con contexto gastronómico rioplatense); modelo `gemini-flash-lite-latest` salvo `GEMINI_MODEL`. Sin `GEMINI_API_KEY` la función queda apagada y el botón no aparece. **Producción pasará a Claude** si todo va bien: otra implementación en `getTranslationProvider()`, sin tocar la pantalla (a pedido y aprobación del usuario).
4. **La respuesta del servicio no se confía:** solo pasan claves que se pidieron, textos no vacíos y dentro de los topes (80 y 300). Los textos de la carta van como datos y la instrucción dice que se ignore cualquier orden escrita en ellos; aun si algo se colara, solo llega a un campo que una persona revisa.
5. **Quién:** Dueño y Staff con sesión y membresía (la acción usa `prepare`), y cuenta que pueda escribir (`canWrite`): una cuenta en solo lectura o suspendida no gasta pedidos y el botón queda deshabilitado. Sin límite de plan, como la traducción manual.
6. **Privacidad:** salen a Google solo los textos de la carta (nombres y descripciones, ya públicos), sin datos personales; la pantalla lo avisa junto al botón. **Con la clave gratuita Google puede usar esos textos para mejorar sus productos** (por eso no sirve para producción). El cuerpo de un error del servicio no se propaga ni se registra. La clave es un secreto de servidor (`GEMINI_API_KEY`; en Fly: `fly secrets set`).
7. **`GEMINI_API_URL`** solo se respeta si apunta a la propia máquina (como `MUX_API_URL`); los E2E usan un Gemini de mentira (`e2e/gemini-stub.ts`) y una clave de pruebas siempre.

## Aceptación
- [x] Dado el formulario de un idioma con algunos campos escritos, cuando se pulsa «Sugerir», entonces se completan solo los vacíos (resaltados), lo escrito queda igual y se informa cuántos campos se completaron.
- [x] Dado que se sugirió pero no se guardó, entonces el progreso y la carta pública siguen igual; al guardar quedan las filas revisadas (editar un campo le quita el resalto) y la carta las muestra.
- [x] Dada una carta sin textos vacíos, entonces el botón informa que no hay nada que sugerir y no llama al servicio.
- [x] Dada una cuenta en solo lectura, entonces el botón está deshabilitado; sin `GEMINI_API_KEY`, no aparece.
- [x] Una respuesta con claves ajenas, vacías o demasiado largas no llega al formulario; un servicio caído da un aviso sin perder lo escrito.
- [x] Con la clave real de Gemini, probado por el usuario en local: «funciona excelente».

## Fuera de alcance
Traducir al guardar o al vuelo en la carta pública; más idiomas; el proveedor Claude (siguiente paso, para producción); límite de uso por local (los pedidos están acotados por clic y exigen sesión de miembro; si hiciera falta, un tope diario va en otra ficha).

## Nivel
**M.** No cambia quién lee o escribe qué ni hay esquema nuevo; lo nuevo es una llamada de servidor a un tercero con una clave propia, acotada a miembros con cuenta al día. Sin revisión independiente por su nivel. Lo que lo subiría a C: guardar sin revisión humana, o enviar datos personales.

## Evidencia
Ejecutada el 2026-10-25; el diff probado es el de esta ficha sobre `7032f0d` (ver `git log` para el commit).
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK.
- Unitarias: `sugerir.test.ts` (qué se pide y en qué orden, validación de la respuesta, tramos, tramo caído, claves ajenas) y `gemini.test.ts` (clave en el encabezado y no en la dirección, texto como datos, error sin cuerpo, respuesta vacía, `GEMINI_API_URL` solo local, función apagada sin clave).
- E2E `e2e/idiomas.spec.ts` **9/9** (7 previas + 2 nuevas) con el Gemini de mentira: no pisa lo escrito, resalta, no guarda hasta «Guardar», quita el resalto al editar, 390 px sin desborde, «no hay nada que sugerir» y solo lectura deshabilitado.
- Prueba del usuario con la clave real de Gemini en local (2026-10-25): «funciona excelente». Sin correr: RLS (no cambia esquema ni permisos).
