# Cambio: rediseño del panel del Dueño y de SuperAdmin

Estado: **Hecho y revisado**; en la rama `feat/ui-panel`, sin integrar a `main` (revisión de Codex pedida por el usuario, ver al final). Nivel **M**: solo presentación; el único dato nuevo que se lee es `menu_palette` y `logo_path` de la organización del propio miembro (ya legibles por RLS). Sin cambios de esquema, permisos ni reglas.

## Objetivo y decisiones (2026-10-17, del usuario)
Llevar el estilo de la carta pública (Gloock + Schibsted Grotesk, papel y tinta, celdas de 24 px con filete, bandas de tono) al panel del Dueño y al de SuperAdmin. Contexto durable en [`PRODUCT.md`](../../PRODUCT.md), [`DESIGN.md`](../../DESIGN.md) (ahora con la sección del panel) y el contrato de dirección en `.impeccable/surfaces/src-app-panel-org-page-tsx.md`.
- **Paleta:** el panel del Dueño se tiñe con la paleta que el local eligió para su carta; SuperAdmin usa la de UcoNext (verde oscuro #155B20, verde vivo #4A9E38 solo decorativo porque no da contraste con texto blanco, blanco y grises cálidos). `PLATFORM_PALETTE` no está en `PALETTES`: ningún local puede elegirla.
- **Alcance:** todas las pantallas de `/panel` y `/admin` y el marco compartido; `/sala` y `/cuenta` heredan marco, fuentes y botones. **El login no se tocó** (sigue con Young Serif, Hanken y cobalto): queda como posible ronda siguiente.
- **Navegación:** riel lateral en escritorio (17 rem, verde profundo, grupos «Tu local», «Gestión», «Servicio») y chips en celular, con **una sola** `<nav>` (los E2E dependen de ello).
- **Mecanismo:** la clase `.panel` (`src/components/panel/panel.css`) redefine los roles de color como en `.carta`; `globals.css` suma los roles Oliva por defecto y los colores de tema `brand`, `brand-deep`, `terra`, `blush`, `sand`. Las pantallas siguen usando `ink`, `muted`, `cobalt`, así que el cambio de marca es casi todo CSS. `.panel-cell` y `.panel-list` (celdas con filete, sin sombra) reemplazan las filas con puntos guía.
- La banda de cada categoría en la Carta del panel usa `toneFor`, igual que ven los comensales (solo cuentan las categorías activas).

## Ronda 2 (2026-10-17), feedback del usuario
(1) SuperAdmin sonaba a restaurante: pasa a **Geist** (títulos 600) y **Geist Mono** para datos, cargadas solo en `/admin` (`admin-fonts.ts`, `.panel-platform`); sin dependencias nuevas (`next/font/google`). (2) Al elegir un local en la lista de SuperAdmin para ver si pagó o desactivarlo, la fila no se marcaba: ahora la fila entera es el enlace (`.panel-pick`), con resalte verde y aro de 2 px al pasar o enfocar, píldora de estado de pago y flecha; la ficha repite estado y plan bajo el título. Verificado: typecheck, lint y 58 E2E (superadmin, planes y pagos, slugs, acceso) sobre seed limpio. Sin nueva revisión independiente (cambio acotado a `/admin`).

## Evidencia
Typecheck, lint, `pnpm test` **453/453** (incluye contraste AA de la paleta de plataforma). E2E sobre seed limpio y build propio: acceso, superadmin (2), alta guiada, carta, mesas, llamados (2), sala, sucursales (2), identidad, opciones, disponibilidad, historial, buscador, menú, legales y ticket de visita; tras los fixes de la revisión se repitieron carta, sucursales, mesas y acceso (85/85). Un desborde a 390 px por un identificador de 64 caracteres en la lista de SuperAdmin lo cazó un E2E y quedó corregido. No se corrió `rendimiento-carta` ni el RLS (no hay cambios de esquema ni de la carta pública).

**Revisión independiente** (revisor del skill, sin historial heredado): primera ronda inválida por capturas recortadas por la barra de desplazamiento del navegador de captura (no era un defecto de la página); segunda, disposición **fix** con tres fixes materiales (foco invisible bajo 64 rem, columna de precios dentada en la Carta, rótulos de grupo en mayúsculas), aplicados y puntuados **resueltos**; **ship**, alcance: esos tres. El detector solo marcó tamaños fuera de la escala de `DESIGN.md`, que el documentador incorporó.

## Pendiente
- Rehacer el login y la sala en vivo (tablet o pantalla fija) si se quiere cerrar el lenguaje visual.
- Probar el panel con un local real que tenga logo claro sobre el riel (el logo va en una caja blanca).

## Revisión y aprobación
**Codex, ronda 1** (commit `3427f60`, nivel M, a pedido del usuario): **aprobar con cambios**, un hallazgo. Importante, real y reproducido: el nombre del local en la cabecera (`app-shell.tsx`) era un ítem flex sin `min-w-0`; con un nombre de 80 caracteres sin espacios, la página medía 1587 px a 390 px de ancho. Corregido con `min-w-0` y `overflow-wrap: anywhere` en el enlace y su contenedor, con prueba de regresión en `e2e/sucursales.spec.ts` (el test móvil renombra el local a 80 «N»; comprobado que fallaba antes de la corrección con «desborde horizontal a 390 px (lo causa a.font-display…)»). Los tres fixes previos de la revisión del skill los dio por corregidos. Verificado tras la corrección, sobre seed limpio: typecheck, lint y 93 E2E (acceso, mesas, sucursales, superadmin, planes y pagos).
**Nota de entorno:** `pnpm db:demo --quitar` no devolvió `resto-moroso` a su estado de seed (dos E2E de mora fallaron hasta correr `pnpm db:reset`): antes de E2E usar `pnpm db:reset`.
