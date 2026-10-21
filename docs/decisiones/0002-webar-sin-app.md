# 0002 — WebAR sin app: `<model-viewer>` con GLB + USDZ

- Estado: descartada — reemplazada por [0031](0031-feed-de-videos-cortos.md) (2026-10-21)
- Fecha: 2026-10-13

> **Descartada (2026-10-21):** el usuario abandonó la realidad aumentada; la fase 2 pasa a ser un feed de videos cortos incluido en Premium ([ADR 0031](0031-feed-de-videos-cortos.md)). Lo que sigue se conserva como registro histórico.

> El modelo de negocio (add-on por suscripción, modelos producidos por UcoMenu) está **aceptado**. La elección técnica queda como propuesta hasta validarla con un spike en un iPhone y un Android reales al iniciar la fase 2.

## Contexto
El add-on de realidad aumentada debe funcionar en iOS y Android desde el navegador, sin instalar aplicaciones, y sin degradar el rendimiento de la carta para quienes no lo usan. Apple y Android usan visores AR nativos distintos y formatos de archivo distintos.

## Decisión
Usar el componente web `<model-viewer>` con `ar-modes="webxr scene-viewer quick-look"`: en Android abre Scene Viewer o WebXR con el `.glb`; en iOS abre AR Quick Look con el `.usdz`; sin soporte AR muestra el visor 3D en pantalla. Se almacenan **ambos formatos** por plato. Los modelos los produce UcoMenu y los carga el SuperAdmin; la función se habilita con el *feature flag* `webar`.

## Alternativas consideradas
- **Plataforma WebAR comercial de terceros** — experiencia propia dentro del navegador, pero con licencia por uso que no cierra para un add-on de bajo precio y dependencia fuerte del proveedor.
- **AR propio con WebXR (three.js)** — control total, pero Safari en iOS no implementa WebXR AR: habría que mantener igual un camino Quick Look aparte.
- **Solo GLB con USDZ generado al vuelo** — `<model-viewer>` puede convertirlo en el momento, pero la conversión tiene limitaciones (p. ej. animaciones) y suma espera en el teléfono. Queda como respaldo, no como camino principal.
- **App nativa** — descartada por requisito del producto.

## Consecuencias
- Cero instalación y cero costo de licencia; se apoya en los visores AR del sistema, que son los de mejor calidad en cada plataforma.
- En iOS y Scene Viewer la experiencia ocurre **fuera de la página**: no se puede superponer interfaz propia (precio, botón) dentro de la vista AR.
- Cada plato requiere producir y validar dos archivos a escala real; el costo de producción es de UcoMenu y debe reflejarse en el precio y el cupo del add-on.
- El visor y los modelos se cargan bajo demanda, solo en platos con modelo publicado.
- El *feature flag* controla la oferta del botón, no el acceso al archivo (URL pública de Storage).

## Fuentes
- https://modelviewer.dev/examples/augmentedreality/
- https://www.khronos.org/news/permalink/model-viewer-1.7-released-with-auto-generation-of-usdz-on-the-fly
