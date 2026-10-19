# 0023 — Carta en varios idiomas: traducciones escritas por el local, sin servicios externos

- Estado: aceptada (el usuario eligió el 2026-10-18 la opción «híbrida sin servicios externos»: textos fijos traducidos por nosotros, traducciones de platos escritas por el local y selector en la carta; la sugerencia automática queda como incremento posterior)
- Fecha: 2026-10-18

## Contexto
Los turistas son parte del público de una carta por QR. `producto.md` dejaba «carta en varios idiomas» fuera de alcance. Traducir platos de forma automática exige una API de terceros (de pago, con clave y con un tercero que recibe los textos del local) o un servicio propio de modelos de traducción (infraestructura que el hosting en contenedor del ADR 0015 no tiene). Los nombres de platos son, además, mal material para traducción automática («milanesa napolitana», «flat white»).

## Decisión
1. **Idiomas:** español (el original de todo lo que carga el local), inglés y portugués. Las traducciones son **opcionales y las escribe el local** en `/panel/{slug}/carta/traducciones`; nada se traduce solo ni sale a ningún servicio.
2. **Dónde viven:** una columna `translations jsonb` (`{"en": {"name", "description"}, "pt": {…}}`) en `categories`, `products`, `option_groups` y `options`, en la misma fila que el texto original. Así la traducción se lee y se escribe con las mismas políticas, el mismo permiso de columna y la misma caché que el texto, sin tablas ni RLS nuevas. Solo los platos tienen descripción. La forma la valida `private.translations_valid` en un `CHECK`: idiomas `en`/`pt`, solo `name` (y `description` en los platos), textos de 1 a 80 (300) caracteres sin espacios en los bordes. Sumar un idioma pide una migración que cambie la lista permitida (decisión consciente: la lista es corta y cerrada).
3. **Qué idioma se ve:** el de `?lang=` en la dirección si el local lo ofrece; si no, el primero de `Accept-Language` que el local ofrezca; si no, español. **No se guarda nada en el dispositivo** (ni cookie ni almacenamiento: la carta promete no hacerlo), así que la elección vive en la dirección y el selector son enlaces que funcionan sin JavaScript.
4. **Qué idiomas ofrece un local:** el español y cada idioma con al menos un texto traducido en lo que está publicado. No hay interruptor aparte: el selector aparece al cargar la primera traducción.
5. **Lo que falta se ve en español, campo por campo.** Un plato con nombre traducido y sin descripción traducida muestra la descripción en español. Es predecible y no oculta información.
6. **Textos fijos** (botones, avisos, etiquetas dietarias, mensajes del llamado) en diccionarios del código (`src/lib/idiomas/textos.ts`), una prueba exige que los tres idiomas tengan lo mismo. Las acciones del llamado reciben el idioma para responder en él.
7. **Los textos legales siguen solo en español** (`/terminos`, `/privacidad`, `/alergenos`): traducirlos pide revisión legal. Los enlaces llevan el rótulo en el idioma elegido pero abren el texto en español.
8. **Sin límite de plan:** la traducción no consume cupo ni se vende aparte; es de todos los planes.

## Alternativas consideradas
- **Traducción automática por API (DeepL, Google):** mejor cobertura sin esfuerzo del local, pero es un tercero con clave y gasto, y recibe el contenido de la carta. Queda como incremento posterior («sugerir traducción» que el local revisa antes de publicar), con aprobación aparte.
- **Modelo abierto propio (LibreTranslate, Argos):** sin tercero, pero un servicio Python aparte, que el hosting actual no tiene; mucha infraestructura para esta función.
- **Traductor del navegador:** gratis, pero fuera de nuestro control (rompe nombres propios) y depende de que el comensal lo active.
- **Una tabla de traducciones genérica (entidad, id, idioma, campo):** claves foráneas débiles y políticas nuevas; la columna en la fila es más chica y más segura.
- **Una tabla por entidad (`product_translations`…):** integridad fuerte pero cuatro tablas, cuatro políticas y cuatro lecturas más en la carta pública, para una función que no cambia autorización.
- **Idioma recordado en cookie o `localStorage`:** contradice la promesa de no guardar nada en el dispositivo (ADR 0022) y obliga a avisar en `/privacidad`.
- **Interruptor por idioma en el panel:** un permiso más (columna de `organizations`) sin valor claro: cargar el primer texto ya expresa la intención.

## Consecuencias
- La clave de caché de la carta pública pasó a `carta-publica-v4` (los datos cacheados traen `translations`).
- Guardar traducciones lee-modifica-escribe la columna entera de cada fila: si dos personas guardan idiomas distintos de la misma fila en el mismo instante, gana la última. Límite aceptado.
- Cambiar de idioma recarga la página (la búsqueda escrita se conserva; el detalle abierto sigue abierto en el nuevo idioma).
- La búsqueda de platos usa los textos del idioma activo.
- Un plato sin traducción en un idioma ofrecido se ve en español dentro de una carta en inglés: es el costo de que la traducción sea voluntaria.
