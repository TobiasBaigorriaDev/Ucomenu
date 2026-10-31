# Cambio: Precios en pesos argentinos
Estado: implementado y verificado en local (2026-10-31); **migración `20261216100000` solo en local**, sin commit; falta la revisión independiente (C) y tu aprobación para staging
Nivel: **C** (dinero: precios de lista de los planes)

## Objetivo
Que todo el precio de lista esté en pesos: la portada ya vendía en ARS y el catálogo `plans` seguía en USD, así que el Dueño veía en Suscripción «US$ 40 USD» cuando le habían prometido ARS 29.000 (hallazgo B3 de la revisión de preparación para producción, 2026-10-31).

## Decisiones
- **Precios (del usuario, 2026-10-31):** Básico ARS 14.900 por mes y 143.040 por año (20 % menos que doce meses); Pro ARS 29.000 por mes y **278.400 por año** (mismo 20 %; reemplaza al «Consultar» de la portada y a la cifra de 287.040 que no cerraba con 23.020 por mes). Premium no se vende: **sin precio de lista** (nulo), no se inventa una cifra.
- **Una sola fuente en la base:** `plans.monthly_price_cents` / `yearly_price_cents` (renombradas desde `*_usd_cents`) más `plans.price_currency` (`ARS` por defecto; `USD` sigue siendo válida como en `payments` y `addons`, pero ningún plan la usa). Las dos columnas son nulas juntas o no nulas juntas (`plans_prices_together_check`).
- **La portada sigue copiando los valores** (la tabla exige sesión): `src/lib/marketing/planes.ts`. Ahora `tests/rls/portada-planes.rls.test.ts` compara también **los precios y la moneda**, no solo los límites; antes la ficha de la portada decía que la prueba avisaba y no era cierto para precios.
- **Suscripción del Dueño:** muestra «$ 29.000 ARS por mes» o «$ 278.400 ARS por año» con la moneda del catálogo; las sucursales adicionales siguen en su línea (también ARS). Un plan sin precio de lista no muestra ninguno.
- **No cambia:** suscripciones, pagos registrados (`payments`, con su moneda), límites, features ni permisos. La facturación sigue siendo manual. Los precios de `addons` (legado de WebAR) no se tocan.

## Aceptación
- [x] El catálogo local tiene Básico 1.490.000 / 14.304.000 centavos, Pro 2.900.000 / 27.840.000 y Premium nulo, todos en ARS.
- [x] La portada muestra los dos planes en mensual y anual, con su equivalente mensual (11.920 y 23.200), sin «a confirmar» ni dólares.
- [x] El Dueño de un Pro anual ve «$ 278.400 ARS por año»; en la prueba gratuita ve «Sin costo» y «Después de la prueba: $ 14.900 ARS por mes» (Básico).
- [x] La base rechaza un plan con un solo precio o con una moneda desconocida; Premium sin precio no muestra nada.
- [x] El Personal no ve ningún precio.

## Fuera de alcance
Cobro automático, tipo de cambio, ajuste por inflación de los precios, facturas, cambio de plan desde el panel y el precio de Premium.

## Evidencia (2026-10-31, árbol sin commit)
- `pnpm test` completo: **1386/1386**, `pnpm lint` sin avisos, `pnpm typecheck` y `pnpm build`: correctos. Nuevas: `precio.test.ts` (plan sin precio), `marketing.test.ts` (anual de ambos planes con el 20 %).
- Migración aplicada solo en la base **local** (`supabase migration up --local`, sin `db reset`: los datos de demostración se conservan) y `pnpm db:types` regenerado (diff de 3 líneas).
- RLS (9 archivos, **244/244**): `portada-planes` (precios, moneda, Premium nulo, constraints), `billing`, `acl`, `planes-pagos`, `limits`, `vistas-previas`, `addons-y-baja`, `retiro-webar`, `reservas`.
- E2E (**45/45**): `suscripcion-precio` (precio en pesos, Personal sin precio), `portada` (incluye el anual de ambos planes), `legal`, `cabeceras-seguridad`.
- **No ejecutado:** la suite RLS completa (las fallas conocidas de `catalog`, `carta`, `tenancy` y `push` vienen de los datos de demostración locales), mutación sobre el `check` (la prueba lo invoca directamente), nada contra staging ni producción.

## (C) Invariantes
1. Los precios de la portada y los del catálogo no se separan: una prueba RLS falla si cambian solo en uno.
2. Ninguna escritura nueva por la API: `plans` sigue siendo de lectura con sesión; el servidor la escribe.
3. Ningún plan muestra un precio inventado: sin precio de lista, la pantalla calla.

## (C) Fallos y recuperación
- Si falla el `db push` de la migración, es una transacción: no queda a medias. Rollback en su encabezado (vuelve los nombres y los valores en USD). **La app anterior no funciona con los nombres nuevos** (lee `monthly_price_usd_cents`): si se aplica la migración en staging o producción hay que desplegar la app nueva en el mismo paso; la lectura de precio falla cerrada (`loadPlanPrice` devuelve `null` y la pantalla no muestra precio), así que el peor caso es un precio ausente, no uno equivocado.
- Orden recomendado en staging: `db push` y despliegue inmediato (hay unos segundos sin precio en Suscripción).

## (C) Revisión y aprobación
- **Ronda 1 (Codex, commit `95fda90`): APROBAR CON CAMBIOS, un hallazgo «importante», real.** El rollback documentado devuelve valores USD fijos, pero la migración pisaba los precios sin conservar los de partida: con un catálogo editado a mano, volver atrás habría dejado precios distintos de los anteriores. Corregido con una **guarda en la migración**: si los precios de partida no son exactamente los del seed (confirmados en local y, solo lectura, en staging el 2026-10-31), se detiene con `plans_prices_unexpected` y no pisa nada. Comprobado en la base local dentro de transacciones deshechas: rollback documentado + migración vuelve a dar los precios en pesos; con Pro cambiado a 4.100 la migración falla y no queda ningún cambio. Codex fue estático (no ejecutó pruebas ni mutaciones).
- **Ronda 2 (Codex, verificación sobre `3b8acb3`): APROBAR CON CAMBIOS, dos hallazgos «importantes», reales.** (1) La guarda leía los precios antes de que el `alter table` tomara el bloqueo: una escritura concurrente confirmada en el medio se pisaba igual. Corregido: la migración toma `lock table public.plans in access exclusive mode` antes de la guarda. (2) Faltaba una prueba persistida de la guarda. Agregada `tests/rls/precios-en-pesos-migracion.rls.test.ts` (5/5): ejecuta la migración real dentro de transacciones deshechas desde el estado que deja su rollback; comprueba que vuelve a pesos, que con un precio editado se detiene sin cambiar nada y que **sin la guarda esa misma migración sí pisa el precio** (mutación de la defensa dentro de la propia prueba). La concurrencia no tiene prueba propia: solo se fija que el bloqueo esté en la migración.
- Ronda 3 (verificación): ver el veredicto abajo cuando termine.
- Aprobación del usuario para staging: **pendiente**. Precios dados por el usuario el 2026-10-31.
