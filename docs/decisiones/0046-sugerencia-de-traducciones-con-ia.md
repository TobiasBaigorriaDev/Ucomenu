# 0046 — Sugerencia de traducciones con IA: el servicio propone, el local revisa y publica

- Estado: aceptada (el usuario eligió el 2026-10-25 empezar con Gemini por su clave gratuita y pasar a Claude en producción si funciona bien)
- Fecha: 2026-10-25

## Contexto
El [ADR 0023](0023-carta-en-varios-idiomas.md) dejó las traducciones de la carta a cargo del local y previó «sugerir traducción» como incremento posterior, con aprobación aparte por ser un tercero con clave y gasto. Cargar a mano toda una carta en dos idiomas es el principal freno para ofrecer el selector.

## Decisión
1. **La IA sugiere; una persona revisa y guarda.** La sugerencia solo llena campos vacíos del formulario del panel; guardar es el mismo paso de hoy, con los mismos topes y el mismo `CHECK`. Nada se traduce al publicar ni al vuelo en la carta pública.
2. **Proveedor detrás de una interfaz** (`TranslationProvider`). Primero **Gemini** con clave gratuita (sirve para desarrollo y staging con datos ficticios); en **producción, Claude** (plan de pago, sin que el contenido se use para entrenar). El cambio es una implementación nueva en un solo punto, sin tocar la pantalla. Haiku 5.5 sale más barato por token que Gemini Flash-Lite según las listas de precios consultadas el 2026-10-25 (a verificar contra las páginas oficiales); el costo de una carta entera es de centavos con ambos.
3. **Qué sale a un tercero:** solo los nombres y descripciones de la carta (ya públicos), sin datos personales. La pantalla lo avisa. Con el plan gratuito de Gemini Google puede usarlos para mejorar sus productos: no se usa esa clave en producción.
4. **Acotado:** requiere sesión de miembro y cuenta que pueda escribir; hasta 300 textos por clic. Sin límite de plan.
5. **La respuesta es no confiable:** se filtra por claves pedidas, texto no vacío y topes; los textos de la carta se mandan como datos.

## Alternativas consideradas
- **Traducir al guardar el plato o publicar sin revisión:** menos esfuerzo, pero los nombres de platos («milanesa napolitana», «flat white») salen mal y el error lo vería el comensal.
- **Traducción al vuelo en la carta pública con caché:** costo y latencia en un endpoint anónimo y necesidad de limitar abuso; contradice los idiomas cerrados y validados.
- **DeepL o Google Translate:** buenos y baratos, pero no aceptan contexto («carta argentina, conservá nombres propios»).
- **Modelo propio (LibreTranslate, Argos):** sin tercero, pero pide un servicio aparte que el hosting no tiene.

## Consecuencias
- Un secreto nuevo de servidor (`GEMINI_API_KEY`; `GEMINI_MODEL` y `GEMINI_API_URL` opcionales) y una dependencia de red en el panel de traducciones; si falla, se traduce a mano como antes.
- Pasar a producción con Claude pide su propia clave y aprobación, y revisar el texto de privacidad si se decide nombrar a los proveedores.
- No hay tope de uso por local: lo acota el clic, la sesión de miembro y la cuenta al día.
