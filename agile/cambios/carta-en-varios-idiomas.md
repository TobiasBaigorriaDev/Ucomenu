# Cambio: Carta en varios idiomas
Estado: integrado a `main` (aprobado por el usuario el 2026-10-18; migración aplicada y app desplegada en staging)
Nivel: M (esquema nuevo, pero sin tocar autorización, dinero ni borrados; ver «Nivel»)

## Objetivo
Que el comensal vea la carta pública en español, inglés o portugués, con las traducciones que el propio local escribe en el panel y sin ningún servicio externo de traducción. Motivos y alternativas: [ADR 0023](../../docs/decisiones/0023-carta-en-varios-idiomas.md).

## Decisiones
1. **Esquema** (`20261028100000_carta_en_varios_idiomas.sql`, aditiva): columna `translations jsonb not null default '{}'` en `categories`, `products`, `option_groups` y `options`, con `CHECK` por `private.translations_valid(translations, con_descripción)`. Permisos: `INSERT`/`UPDATE` de la columna para `authenticated` (las políticas y los demás permisos por columna no cambian); la lectura ya era por tabla. La función es pura, vive en `private` y solo `authenticated` y `service_role` pueden ejecutarla (el `CHECK` corre con los permisos de quien escribe); `acl.rls.test.ts` la declara.
2. **Idioma por pedido** (`?lang=` > `Accept-Language` > español, entre los que el local ofrece), sin cookies ni almacenamiento. El selector son enlaces `?lang=` (sin JavaScript) y solo aparece si el local ofrece más de un idioma; ofrece los que tengan al menos un texto traducido.
3. **Resolución en el servidor**: `getPublicMenu` devuelve los textos originales con sus traducciones (misma lectura cacheada, clave `carta-publica-v4`) y la página aplica `localizeSections` (cada campo cae al español por separado y las traducciones no viajan al navegador). `PublicMenuView` y los componentes reciben `lang`; `MenuBrowser` guarda el id del plato abierto, no el plato, para que cambiar de idioma con el detalle abierto lo muestre traducido.
4. **Textos fijos** en `src/lib/idiomas/textos.ts` (es/en/pt), con una prueba que exige los mismos textos en los tres idiomas. El texto en español es el que ya mostraba la carta. El `lang` de cada pedido entra a `createWaiterCallAction` (campo oculto) para que la respuesta del llamado salga en el idioma de la carta. `<div lang>` en la carta marca el idioma para lectores de pantalla y para el traductor del navegador.
5. **Panel**: `/panel/{slug}/carta/traducciones?idioma=en|pt`, enlazado desde la Carta. Un solo formulario por idioma con todo el árbol (categoría → platos → variantes y adicionales → opciones, también lo oculto), el texto original al lado de cada campo y el avance («9 de 23 textos»). Guarda solo las filas que cambiaron; un campo vacío quita esa traducción. Dueño y Staff, con los mismos controles de cuenta que el resto de la carta (solo lectura y suspendida: campos deshabilitados y aviso; la base lo exige igual). Ante un error se conserva lo escrito.
6. **Textos legales** sin traducir (piden revisión legal); sus enlaces llevan el rótulo en el idioma elegido.
7. **Sin límite de plan.** Sin traducción automática.

## Aceptación
- [x] Dado un local sin traducciones, cuando se abre su carta (con cualquier idioma en el navegador), entonces se ve igual que antes y no hay selector.
- [x] Dado el Dueño o el Staff en `/panel/{slug}/carta/traducciones`, cuando escribe las traducciones al inglés de una categoría, un plato (nombre y descripción), una variante y una opción y guarda, entonces la carta pública las muestra al instante (caché invalidada), con el selector Español/English, el precio y las diferencias de precio intactos.
- [x] Dado un plato con nombre traducido y sin descripción traducida, entonces la descripción se ve en español; vaciar un campo devuelve ese texto al español sin tocar el resto.
- [x] Dado un navegador en inglés (o `?lang=en`) y un local que ofrece inglés, entonces la carta abre en inglés y el pedido explícito manda sobre el navegador; un idioma que el local no ofrece se ve en español, sin error.
- [x] Dada la carta de una mesa, cuando se elige un idioma, entonces «Llamar al mozo»/«Pedir la cuenta» y la respuesta salen en ese idioma y cambiar de idioma no pierde la mesa ni el llamado.
- [x] La búsqueda, el detalle del plato, los avisos de alérgenos y las etiquetas dietarias hablan el idioma elegido.
- [x] La base rechaza (23514) formas inválidas: idiomas ajenos, claves ajenas, descripción fuera de los platos, textos vacíos, con espacios en los bordes o más largos que el original.
- [x] Otra organización y anónimos no escriben traducciones; un plato oculto no publica las suyas; en solo lectura y suspendida la base no deja guardar (en gracia sí).
- [x] No se guarda nada en el dispositivo (sin cookies ni almacenamiento) y 390 px sin desborde en la carta (con selector) y en el panel.

## Fuera de alcance
Traducción automática o «sugerir traducción» (incremento posterior, con aprobación por ser un tercero); más idiomas que en/pt; traducir los textos legales; idioma recordado entre visitas; traducir el nombre de la organización o de la sucursal; traducciones de etiquetas dietarias personalizadas (son cerradas); idioma del panel.

## Nivel
**M.** No cambia quién puede leer o escribir qué: la traducción viaja en la fila del texto original y hereda sus políticas; lo único nuevo es un permiso de columna de escritura para los mismos miembros que ya editaban la fila. Sin dinero, sin borrados y sin datos personales; la carta no guarda nada en el dispositivo. Lo que lo subiría a C: un permiso distinto del de la carta, un idioma por plan (dinero) o guardar la elección del comensal. Sin revisión independiente por su nivel.

## Evidencia
Ejecutada el 2026-10-18 sobre `pnpm db:reset` (migración `20261028100000_carta_en_varios_idiomas.sql`) y un `pnpm build` del código final. El commit probado es el de la rama (`git log`); el cierre documental no cambia código.
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK · `pnpm db:types` regenerado.
- `pnpm test` **644/644**. Nuevas: `src/lib/idiomas/{idiomas,traducciones,localizar,textos}.test.ts` (resolución del idioma y de `Accept-Language`, lectura tolerante, caída al español por campo, topes por caracteres, idiomas ofrecidos, los tres idiomas con los mismos textos y sin textos a medio traducir, mensajes del llamado sin filtrar plan ni pago en ningún idioma) y una prueba nueva en `public-menu.test.ts` (traducciones con forma rota no rompen la carta).
- `pnpm test:rls` **727/727** en 32 archivos. Nuevo `tests/rls/traducciones.rls.test.ts` (17): CHECK (válidos, 13 formas inválidas con `23514`, límites exactos, nulo), permisos (Dueño y Staff en las cuatro tablas, alta con traducción, persona de otra organización y anon sin escribir, padre y organización fijos), lectura pública (lo publicado sí; plato o categoría ocultos no; `loadRows` con las cuatro tablas), cuenta (gracia escribe; solo lectura y suspendida no) y el módulo del panel con personas reales (árbol con lo oculto, guardado solo de lo que cambió sin pisar otros idiomas, vaciar, ignorar filas ajenas, topes sin escribir nada, cuenta bloqueada). `acl.rls.test.ts` declara `translations_valid`; `opciones.rls.test.ts` suma `translations` a sus columnas esperadas.
- E2E: `e2e/idiomas.spec.ts` **6/6** (flujo del panel a la carta en inglés, selector, detalle, búsqueda, volver al español, idioma no ofrecido, vaciar un campo; idioma del navegador sin cookies ni almacenamiento; portugués; llamado desde la mesa en inglés y español; solo lectura; Staff, texto largo forzado y local ajeno). Suite completa: la primera corrida con `--workers=1` pasó 105 pruebas y después el servidor de pruebas (`next start`) dejó de responder (el resto falló por conexión, sin relación con el cambio); se repitió el resto de los archivos en dos tandas: **79/79** y **129/129**.
- Revisión visual a 390 px (carta en inglés con selector, detalle del plato, panel) y 1280 px (panel): sin desborde; en escritorio los campos del panel quedan alineados aunque los grupos y opciones se sangren.
- No ejecutado: teléfono real, lectores de pantalla, Safari/iOS, y el traductor del navegador sobre `lang`. Migración **no aplicada en staging ni producción** (con aprobación).

## Aprendizajes
- Las políticas públicas de lectura hacen legible lo publicado para cualquier persona autenticada, no solo para anónimos: una prueba de aislamiento de lectura tiene que mirar lo OCULTO (plato inactivo), no lo activo.
- `Accept-Language` por defecto de Playwright es `en-US`; `playwright.config.ts` fija `es-AR`, así que ninguna prueba existente cambia de idioma. Las pruebas del idioma del navegador crean su propio contexto.

## Integración
- Aprobada por el usuario tras probarla en local (2026-10-18) e integrada a `main` con `Merge feat/carta-multiidioma`. Sin revisión independiente, por su nivel.
- Migración `20261028100000` **aplicada en staging** (2026-10-18): `supabase db push --dry-run` listó solo esa y `db push` la aplicó; `migration list` la muestra en local y remoto. (Un primer intento fue bloqueado por el control de permisos; salió al repetirlo con la orden explícita del usuario.) Es aditiva y el código anterior la ignora. App desplegada a staging el mismo día (`fly deploy -c fly.staging.toml` con la imagen oficial en Docker): rutas públicas 200 y la pantalla nueva del panel exige sesión. Sin traducciones en `demo`, la carta de staging se ve en español.
