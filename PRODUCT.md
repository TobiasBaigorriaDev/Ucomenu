# Product

<!-- impeccable:product-schema 1 -->

> Resumen orientado a diseño. La fuente de verdad de qué hace el producto es [`docs/producto.md`](docs/producto.md); acá solo viven los hechos que condicionan las decisiones de interfaz. Si hay conflicto, manda `docs/producto.md`.

## Platform

web

## Users

- **Comensal (usuario principal de esta superficie).** Sentado a una mesa de un café, bar o restaurante argentino, con el celular en una mano y a veces poca luz. Entra escaneando el QR de su mesa o con el enlace de la sucursal. Es anónimo: sin cuenta ni app. Trabajo: ver la carta al instante, encontrar lo que puede comer (también por dieta) y, si entró por QR, llamar al mozo o pedir la cuenta sin levantar la mano.
- **Dueño y Staff del local.** Usan el panel (`/panel`) y la sala (`/sala`), no la carta pública. Importan acá porque eligen la apariencia de su carta (logo y paleta) y declaran etiquetas y disponibilidad de cada plato.
- **SuperAdmin de UcoMenu.** Equipo interno; no interviene en la carta pública.

## Product Purpose

UcoMenu es una plataforma web mobile-first y multi-tenant, vendida por suscripción, que le da a cada local una carta digital de alto impacto, un canal directo mesa → mozo y, más adelante, platos en realidad aumentada y tarjeta de fidelidad. Éxito para la carta pública: el comensal entiende en segundos de qué local y sucursal es, encuentra su plato sin fricción y el local siente que la carta es suya.

## Positioning

La carta de cada local lleva su propia identidad (logo y paleta) y convive con el llamado al mozo desde la mesa, sin instalar nada ni comprar hardware. La combinación de carta con identidad propia por organización, llamado desde el QR de la mesa y estado en vivo por sucursal (agotado) es lo que un PDF o una carta impresa no pueden copiar.

## Operating Context

- Entradas: QR único por mesa (`/t/{token}`, habilita el llamado) o enlace directo de la sucursal (`/m/{org}/{sucursal}`, sin mesa).
- Mercado inicial Argentina, es-AR. Pantalla de referencia 390 px de ancho; escritorio es secundario.
- Solo consulta: no hay pedidos ni pago online desde la carta.
- Cada organización tiene varias sucursales con carta compartida; la disponibilidad se ajusta por sucursal.

## Capabilities and Constraints

- La carta muestra categorías y platos activos con nombre, descripción, precio base y foto opcional; variantes y adicionales son informativos; el detalle abre en una ficha superpuesta que conserva el contexto.
- Buscador por nombre y descripción, combinable con filtros dietarios (Sin TACC, Vegano, Vegetariano). Las etiquetas las declara el local y no son una certificación; el aviso de alérgenos aparece donde importa —al filtrar por una etiqueta— y se repite en el detalle del plato y en el pie; el inicio de la carta no lleva avisos largos (decisión del usuario, 2026-10-17).
- Un plato agotado en la sucursal se muestra como «Agotado», nunca desaparece.
- Cada local elige una de cuatro paletas cerradas (Oliva, Azul, Vino, Cacao) con contraste AA verificado y un logo opcional. La carta aplica la paleta con variables CSS dentro de `.carta`; los tokens globales también sirven al panel y no se tocan sin avisar.
- Una carta puede tener muchas categorías y platos, con y sin foto: ningún componente puede depender de que haya imagen.
- Presupuesto de rendimiento comprobado por E2E (`e2e/rendimiento-carta.spec.ts`).
- Sin dependencias nuevas sin aprobación del usuario.

## Brand Commitments

- El local es el protagonista visual de la carta: su nombre, su logo y su paleta mandan.
- Firma discreta «Hecho con UcoMenu» al pie, como vitrina del producto, nunca en el encabezado.
- Voseo cercano en español rioplatense, cálido, claro y breve («Probá con otro nombre», «consultá al personal»).
- Dirección de rediseño fijada por el usuario: Bento + Editorial + Card-based, con tipografía nueva que él aprueba antes de aplicarla y las cuatro paletas actuales sin cambios.

## Evidence on Hand

- Solo datos semilla locales: `cafe-ejemplo` (Oliva) y `parrilla-demo` (Cacao), en `supabase/seed.sql`, con pocos platos y casi sin fotos.
- No hay fotografías reales de platos, logos de clientes ni testimonios. No inventar locales, métricas ni reseñas; el material de demostración se rotula como sintético.

## Product Principles

1. El local primero: la interfaz sirve a la identidad de cada local y nunca compite con ella.
2. Encontrar antes que admirar: escaneo rápido con una mano y poca luz; la expresión editorial no estorba a la búsqueda ni a los filtros.
3. Honestidad de datos: lo que el local no declaró no se afirma (etiquetas, alérgenos, disponibilidad).
4. Funciona con lo que hay: con foto o sin ella, con 5 platos o 300, con cualquiera de las cuatro paletas.
5. Cambios de interfaz sin cambios de reglas: la presentación nunca altera permisos, datos ni precios.

## Accessibility & Inclusion

- Contraste AA en las cuatro paletas (`src/lib/identidad/palettes.test.ts`), objetivos táctiles de al menos 44 px, foco visible, `prefers-reduced-motion` respetado y 390 px sin desborde horizontal.
- Texto en español rioplatense; nombres largos de platos y de locales deben partir sin romper el diseño.
