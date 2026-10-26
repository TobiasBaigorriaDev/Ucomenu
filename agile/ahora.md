# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Claude. Historia en Git y fichas.

## Punto de retomada

**Llamados dentro de «Mesas» (nivel M): hecho, en `origin/main` (`7a1e2d1`) y en staging (Fly v57).** Pedido del usuario: que el mozo trabaje en una sola pestaña. La pantalla «Sala en vivo» (lista de llamados) desapareció de la navegación de la Sala, que queda con **Mesas en vivo** y **Volver al panel principal**; `/sala/{slug}` redirige a `/sala/{slug}/mesas`. Cada tarjeta de mesa muestra sus llamados con «Atendido», y Mesas absorbió el sonido, el aviso del sistema, el selector de sucursales y los anuncios. Un solo sondeo (`/mesas/estado`); `/sala/{slug}/estado` queda solo para el cartel del panel. Decisiones, aceptación y evidencia en la [ficha](cambios/mesas-con-llamados.md). Sin migración.

Verificado: typecheck, lint, build, 1180 pruebas unitarias y 150 E2E de los archivos que tocan la sala o el panel (ver la ficha para las dos fallas que se repitieron). **Falta tu prueba con sesión real y en teléfono.**

Ajuste posterior, **solo en local y sin desplegar**: opción «Ver como: Tarjetas | Filas» (mismos datos, se recuerda en el dispositivo) y los nombres «Mesas en vivo» y «Volver al panel principal».

El enlace «Sala en vivo» del panel (con la alerta y el contador) se conserva y ahora lleva a Mesas.

Antes: resumen de analítica con IA en staging (Fly v56), a probar con un Dueño; hoy usa Gemini con clave gratuita (solo datos ficticios; pasar a Claude antes de ventas reales).

Rama `main`, subida a `origin/main`.

## Límites y bloqueos

- S4 (Clientes recurrentes) bloqueado por la revisión legal.
- Reinicios de QR: en staging desde Fly v53; falta tu prueba con sesión real y teléfono ([ficha](cambios/reinicio-programado-qr.md)).
- Si Windows repite `0xC0000409` con `forks`, repetir con `--pool=threads`. Si `pnpm build` falla con `EPERM` dentro de `.next`, borrar `.next` y repetir. Docker Desktop hay que encenderlo para RLS y E2E.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.
- Producción bloqueada por dominio, revisión legal y purgas.

## Próximo paso

Probar Mesas en staging, en un teléfono, con un local Pro (llamar desde un QR, atender, anotar). Siguiente migración libre: `20261207100000`.
