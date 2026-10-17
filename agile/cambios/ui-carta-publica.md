# Cambio: rediseño de la interfaz de la carta pública

Estado: **En curso (iterando con el usuario)**. Nivel **M**: varias piezas de presentación, sin consecuencias C (no toca autorización, datos expuestos, dinero ni borrados). Rama `feat/ui-carta`, desde `main`.

## Objetivo y método
Modificar la UI de la carta pública (`/m/{org}/{sucursal}` y `/t/{token}`) según lo que el usuario vaya pidiendo y comentando. Se itera en vivo con `pnpm dev` y recarga en caliente; cada ronda es un cambio pequeño que el usuario ve, aprueba o corrige. Se usan los skills de frontend (`impeccable`, `frontend-design`).

## Restricciones (no negociables salvo decisión explícita)
- Solo presentación: sin cambios de esquema, RLS, lecturas ni reglas de negocio.
- Se conservan las paletas por organización (variables CSS de `.carta`), el logo, el buscador, los filtros, el detalle del plato, el estado Agotado y los avisos de alérgenos.
- Accesibilidad y móvil primero: 390 px sin desborde, objetivos táctiles de 44 px, contraste AA en las cuatro paletas (`src/lib/identidad/palettes.test.ts`), foco visible, `prefers-reduced-motion`.
- Si un cambio de diseño necesita tocar los tokens de `globals.css` o las paletas, se avisa antes: afecta al panel y al contraste probado.

## Contexto de diseño y decisiones (2026-10-17)
Contexto durable en [`PRODUCT.md`](../../PRODUCT.md) y en el surface brief con el contrato de dirección (`.impeccable/surfaces/src-app-m-org-branch-page-tsx.md`); no se repiten aquí. `DESIGN.md` se genera al cerrar la primera iteración construida, no antes.
- **Alcance:** rediseño profundo; se conservan funciones, contenido y las cuatro paletas por local.
- **Dirección fijada por el usuario:** Bento + Editorial + Card-based.
- **Bento:** portada y categorías, platos destacados y todo el listado. **Editorial:** jerarquía de revista y asimetría con quiebres de grilla.
- **Fotos:** mezcla; las cards funcionan con y sin foto. **Marca:** el local manda, con firma discreta «Hecho con UcoMenu» al pie. **Voz:** voseo cercano.
- **Tipografía nueva:** se propone en el chat con motivos y la aprueba el usuario antes de aplicarla (pendiente). Paletas sin cambios.

## Rondas
(vacío; se registran aquí las peticiones y decisiones de cada ronda)

## Aceptación
- [ ] Los cambios pedidos por el usuario están hechos y aprobados por él en el navegador.
- [ ] Móvil (390 px) y escritorio (1280 px) sin desborde; contraste y foco intactos en las cuatro paletas.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` y los E2E de carta (`menu`, `buscador`, `disponibilidad`, `identidad`, `rendimiento-carta`) en verde; ajustar los E2E que dependan de textos o estructura que cambien por decisión de diseño.

Evidencia: pendiente.
