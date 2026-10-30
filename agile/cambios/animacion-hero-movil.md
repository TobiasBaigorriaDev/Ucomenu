# Animación del hero en móvil

Nivel M · 2026-10-30 · sobre `a26b9e8`.

El usuario pidió que las cinco cartas del hero roten en bucle solo en pantallas móviles. Se conserva el abanico y las capturas existentes.

## Aceptación

- En móvil cada carta pasa por el centro en un ciclo continuo, con transición suave y sin botón de pausa, por pedido del usuario.
- Con movimiento reducido, en escritorio o fuera de pantalla no avanza automáticamente.
- El hero permanece visible sin JavaScript y no aparecen desbordes ni cambios de escritorio.
- Sin dependencias nuevas ni cambios de datos.

## Evidencia

- Diff local sin commit: `pnpm build` y `pnpm typecheck` correctos; ESLint focalizado correcto.
- `e2e/hero-movil.spec.ts` contra el servidor de desarrollo local en Chromium: 3/3, ciclo de cinco cartas y vuelta al inicio, pausa/reanudación, suspensión fuera de pantalla, 320 px sin desborde, escritorio y movimiento reducido. Una primera corrida falló por una carrera de la prueba con el observador de visibilidad; se esperó su activación y pasó.
- Capturas de móvil y escritorio inspeccionadas en `output/ux/`. No se probó en un teléfono físico ni se desplegó. La prueba se corrió con configuración local sin global setup ni base.

El usuario pidió acelerar la rotación y quitar el botón de pausa: intervalo de 4 a 3 segundos; se conserva movimiento reducido y suspensión fuera de pantalla. La animación ya no tiene control de pausa manual.

- Tras el ajuste: ESLint focalizado y 3/3 pruebas Chromium contra el servidor local; ciclo de tres segundos, sin bot?n, escritorio y movimiento reducido sin avance y suspensi?n fuera de pantalla. No se repiti? build despu?s de este ajuste local.
