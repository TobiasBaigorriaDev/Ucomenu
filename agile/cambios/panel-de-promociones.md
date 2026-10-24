# Cambio: Panel de promociones del Dueño
Estado: **implementado y verificado en local (2026-10-23).** Tercera pieza de S2 ([ADR 0040](../../docs/decisiones/0040-promociones-programadas.md)): usa la base de [promociones y precio efectivo](promociones-y-precio-efectivo.md). La [carta](carta-con-precio-promocional.md) y el [historial](historial-de-promociones.md) son las fichas hermanas.
Nivel: **M** — pantallas y una función de base `SECURITY INVOKER`; no cambia permisos ni dinero respecto de la ficha C (la base ya impone Dueño, plan y cuenta al día). Sin revisión independiente por su nivel.

## Objetivo
Que el Dueño cree, edite, pause, duplique y borre promociones, vea cuáles se pisan y pueda mirar qué precio tendría cada plato un día y a una hora, sin tocar la base a mano. El Staff las ve.

## Decisiones (particulares)
1. **Rutas** `/panel/{slug}/promociones` (lista + vista previa), `/nueva`, `/{id}` (editar) y `/historial`. Entrada «Promociones» en «Tu local» para Dueño y Staff. La lista se abre aunque la cuenta esté en solo lectura o suspendida (las promociones se ven); `nueva` y `{id}` son solo del Dueño (`requireOwner`: el Staff vuelve al panel). Una promoción de otro local o inexistente da 404.
2. **Guardado atómico**: `public.save_promotion(...)` (migración `20261124100000`, `SECURITY INVOKER`) crea o edita la promoción y deja sus platos, categorías y sucursales exactamente como las listas pedidas, en una transacción. Sin ella, un fallo a mitad de camino dejaba una promoción sin sus platos. Al ser *invoker* no amplía ningún permiso: manda la RLS del Dueño, las claves compuestas (un plato o sucursal ajenos fallan con `23503`) y el historial por trigger. Las filas que se conservan no se tocan (no dejan constancia).
3. **Quién escribe, doble barrera**: el módulo corta antes con el estado de la cuenta (`promocionesWriteBlock`: mora, luego plan) para dar un mensaje claro, y la base lo vuelve a imponer. Un 42501 se explica con el estado de la cuenta si lo hay; un UPDATE o DELETE que afecta 0 filas se distingue leyendo (no encontrada / sin permiso).
4. **Formulario**: tipo (porcentaje entero 1–100, monto, precio fijo; los importes en pesos con el formato de la carta), días en que empieza la franja, «Todo el día» o desde/hasta (`hasta` anterior a `desde` cruza la medianoche; `hasta` 00:00 o 24:00 = medianoche; inicio = fin se rechaza y «todo el día» tiene su casilla), fechas opcionales, sucursales (todas o algunas; con una sola sucursal no se pregunta), categorías y platos puntuales con buscador. **El buscador solo oculta**: una casilla oculta sigue marcada y viaja en el envío (un desmontaje la perdería). Hay que elegir al menos una categoría o un plato. Con un error se conserva todo lo escrito, también las listas (el borrador viaja como JSON en `values`).
5. **Pausar** = `is_active` explícito (nunca alterna a ciegas); **duplicar** = copia **pausada** con el nombre «… (copia)» recortado para entrar en 80 caracteres (no duplica el descuento hasta que se la active); **borrar** pide confirmación y deja constancia en el historial.
6. **Aviso de superposición** (informativo, no bloquea): dos promociones **activas** que comparten algún plato (las categorías se resuelven a platos), alguna sucursal, algún momento de la semana (circular: una franja del domingo a la noche llega al lunes) y algún tramo de fechas. Es una aproximación: no alinea los días de la semana con fechas muy cortas, así que puede avisar de más pero no de menos. Dice que donde coinciden cada plato se vende al menor precio.
7. **Vista previa por día y hora**: formulario GET (`?sucursal=&fecha=&hora=`, enlazable) que llama a la misma `effective_prices` con el instante pedido (`instantAt`: la hora de pared de la sucursal convertida a instante; la hora que no existe en el salto de horario de verano se corre una hora). La base solo respeta ese instante a un miembro de la organización: sirve también al Staff y no destapa promociones futuras a la carta. Un error de lectura se muestra como error, nunca como «ningún plato».
8. **Qué no hace**: variantes y adicionales no cambian de precio; no hay prioridad manual entre promociones (gana el precio más bajo); no hay plantillas.

## Aceptación
- [x] El Dueño crea una promoción con todos sus campos y aparece en la lista con su descuento, días, horario, fechas, alcance y sucursales.
- [x] Editar guarda y conserva lo no tocado; un valor fuera de rango se rechaza **conservando lo escrito**, también las casillas.
- [x] Pausar y reanudar cambian la carta en el acto; duplicar da una copia pausada; borrar pide confirmación.
- [x] Dos promociones activas que se pisan se avisan mutuamente; una pausada no pisa a nadie.
- [x] La vista previa da los mismos precios que la carta a la hora pedida; con la promoción pausada no hay nada.
- [x] El Staff ve la lista, la vista previa y el historial sin ningún botón de cambio, y la pantalla de alta lo devuelve al panel; Básico ve el aviso de plan y no puede crear; en solo lectura se ve, se sigue aplicando y no se cambia.
- [x] Un alta o una edición que falla (plato o sucursal ajenos, valor rechazado, promoción inexistente) no deja nada a medias.

## Evidencia
Migración `20261124100000`, sobre el diff de `main` (2026-10-23):
- `pnpm db:reset` y `pnpm db:types`; `pnpm typecheck`, `pnpm lint` y `pnpm build` en verde.
- Unitarias `src/lib/promociones` 62/62 (validación del formulario con cada problema, descripciones en palabras, superposiciones incluida la franja que cruza la semana, mensajes, `instantAt`).
- RLS `panel-promociones` 15/15 (guardado atómico con fallos, quién puede, pausar, duplicar, borrar, superposiciones, vista previa, lectura con paginación de 50) y suite completa de RLS **57 archivos, 1276 pruebas, 0 fallas** (incluye la matriz de `acl` con `save_promotion` como `SECURITY INVOKER`).
- E2E `promociones` 7/7 a 390 px (alta, edición con error, pausa, duplicado, superposición, borrado, historial, vista previa, Staff, Básico y solo lectura). Capturas del panel y de la carta revisadas a 390 px. E2E completo: 440 pasaron y 1 falló por un *worker* caído (`0xC0000409`, ajeno; repetido pasa); ver [cierre de la ficha de la carta](carta-con-precio-promocional.md#cierre).
- No probado: un teléfono real; Safari; lector de pantalla; un menú de miles de platos en el selector (la lista de platos es una caja con desplazamiento y buscador, sin virtualizar).
