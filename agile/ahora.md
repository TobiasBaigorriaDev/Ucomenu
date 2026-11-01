# Ahora (handoff)

Actualizado: 2026-10-31 · agente saliente: Codex.

## Punto de retomada

Rama `main`, último commit al iniciar: `b881eb2`. Se agregó localmente el tutorial solicitado al bloque «Primeros pasos» del Resumen (`src/components/panel/primeros-pasos.tsx`). Se muestra únicamente cuando la guía está pendiente y visible; respeta su ocultamiento existente y desaparece al completarse. Usa controles nativos, reproducción manual, carga al reproducir y enlace alternativo al MP4. No cambia reglas, permisos ni base de datos.

El original de Descargas, `tutorial_primeros_pasos_ucomenu.mp4`, quedó intacto. La copia web está en `public/tutoriales/primeros-pasos.mp4`: H.264/AAC, 1280×720, 2:27 minutos, aproximadamente 9,6 MB, con inicio rápido. La portada JPG proviene del segundo 2. No se publicó ni se creó commit. Verificación del diff local: 20 pruebas de la guía aprobadas, typecheck y lint del componente sin errores; MP4 decodificado completo sin errores y portada inspeccionada. No se ejecutaron build ni E2E para este cambio local de presentación.

La lista Pro de la portada ya menciona reservas y reseñas en Google (commit de inicio). Staging era Fly v89: precios en pesos y cierre de preparación para producción. Consultar Git y Fly antes de continuar. La migración aplicada era `20261216100000`; siguiente libre `20261217100000`. Evidencia, recuperación y pendientes en [precios](cambios/precios-en-pesos.md) y [cierre](cambios/cierre-revision-de-lanzamiento.md).

## Bloqueos y próximo paso

Próximo paso: comprobar el tutorial en un Resumen con guía pendiente; publicarlo requiere autorización. Sigue pendiente la prueba del usuario de Suscripción en staging y textos legales.

Antes de producción: razón social, CUIT, domicilio y correo real; revisión de contador y abogado; WhatsApp definitivo; elección de Supabase; proyecto y app de producción, Mux y Gemini, respaldo ensayado y pruebas en teléfono. Las tareas de cron pendientes están en `docs/produccion.md` (4.b, 4.c y 4.e); verificar también el cron de reservas.

Preservar los archivos ajenos sin seguimiento: `video/`, `.codegraph/`, capturas y herramientas locales, skills de terceros, `skills-lock.json` y `.claude/launch.json`. No se tocaron durante este cambio.
