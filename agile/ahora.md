# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Rama `feat/ui-carta`, desde `main` (subido a `origin/main`). Tarea en curso: [rediseño de la UI de la carta pública](cambios/ui-carta-publica.md), nivel M, iterada en vivo con el usuario. Ya están el contexto de diseño [`PRODUCT.md`](../PRODUCT.md) y el contrato de dirección en `.impeccable/surfaces/src-app-m-org-branch-page-tsx.md`: Bento + Editorial + Card-based, fijada por el usuario, con las cuatro paletas por local sin cambios. Aún no se tocó la UI. `DESIGN.md` no existe a propósito: lo escribe el documentador al cerrar la primera iteración construida.

La demo está llena con `pnpm db:demo` (fotos, 7 categorías por local, logo; ver README). Antes de correr RLS o E2E hay que volver al seed limpio con `pnpm db:reset` o `pnpm db:demo --quitar`.

El servidor de desarrollo corre en `http://localhost:3000/m/cafe-ejemplo/centro` (`pnpm dev`, recarga en caliente); `parrilla-demo/sur` sirve para la paleta Cacao.

## Bloqueos y riesgos

- Falta que el usuario apruebe el **par tipográfico nuevo** antes de aplicarlo. Tampoco está activado el modo en vivo de `impeccable` (inyecta un script temporal): requiere su aprobación.
- Los E2E de carta (`menu`, `buscador`, `disponibilidad`, `identidad`, `rendimiento-carta`) pueden depender de textos o estructura que cambien: ajustarlos por decisión de diseño, no por accidente. Contraste AA de las cuatro paletas: `src/lib/identidad/palettes.test.ts`.
- Producción sigue bloqueada ([ficha](cambios/salida-a-produccion.md), ADR 0015); migraciones solo en local. «Desactivar sucursales» quedó en el backlog con sus decisiones aprobadas.

## Próximo paso

1. Proponer 2–3 pares tipográficos fuera de la lista de fuentes por defecto del skill, con su motivo; el usuario elige.
2. Construir la primera ronda: encabezado editorial y bento de categorías; luego cards de plato y listado. Registrar cada ronda en la ficha.
3. Al cerrar la primera iteración: revisión final del skill, `DESIGN.md` y `.impeccable/design.json`, luego typecheck, lint, build y E2E de carta.
