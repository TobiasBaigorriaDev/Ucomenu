# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

La **carga y publicación de videos con Mux** (partes A y B, nivel C, ADR 0031) está **hecha y en staging (Fly v21)**: [parte A](cambios/videos-del-panel-base.md) y [parte B](cambios/videos-mux-parte-b.md), aprobadas por Codex (3 rondas la B; dos carreras de huérfanos corregidas) y por el usuario. Se probó de punta a punta con Mux real: un navegador móvil emulado y, además, un **iPhone 16 con `.mov` HEVC** del usuario (subida, «Listo» solo con miniatura, despublicar, borrar —el asset desaparece de Mux— y rechazo de un video de más de 30 s). Los commits están **solo en local** (último `be6c4c8` + el de cierre), sin `git push`.

## Bloqueos y límites

Sin bloqueos. Pendiente menor: probar en un **Android** real. La organización de prueba `prueba-videos` (Premium) es del usuario (`tobibaigorria2023@gmail.com`); él también tiene 1 video de prueba en `cafe-de-ensayo` (borrador, listo). El plan Free de Mux guarda hasta 10 assets (hay 1). El peso de 50 MB solo se valida en el navegador. El secreto de firma del webhook ya es el correcto y está en Fly. No se hizo `pnpm build` local (pisaría el `.next` de los servidores del usuario). Con los escenarios locales cargados fallan 15 pruebas RLS y varias E2E por datos extra.

## Próximo paso

Decidir con el usuario si se sube `main` a `origin`. Siguiente ítem de la fase 2: el **feed vertical en la carta** (nivel M): lectura pública de los videos (`anon`) con su caché, el reproductor HLS (Safari reproduce HLS nativo; en el resto hace falta `hls.js` o `mux-player`, una dependencia nueva que requiere aprobación) y el enlace «Ver plato»; debe cargarse bajo demanda sin penalizar el LCP de la carta. Después, likes y comentarios (nivel C, desde la mesa) y los textos legales.
