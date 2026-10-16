# Cambio: Variantes y adicionales — grupos de opciones por plato, en el panel y en la carta pública
Estado: verificado (pendiente de integrar por el agente principal)
Nivel: M (esquema nuevo, pero sin dinero cobrado ni lectura anónima más allá de lo activo; ver «Nivel» abajo)

## Objetivo
Que el Dueño y el Staff carguen, por plato, **variantes** (se elige una: tamaño, punto de cocción) y **adicionales** (extras opcionales, hasta N) con su diferencia de precio, y que la carta pública los muestre bajo el plato como información («+ $ 600»). No hay pedidos ni carrito: el precio del plato sigue siendo el base.

## Decisiones
1. **Esquema** (`20261019100000_variantes_y_adicionales.sql`, aditiva): `option_groups` (plato, nombre 1–80, `min_choices`, `max_choices` 1–50, orden, activo, con `check` min ≤ max) y `options` (grupo, nombre 1–80, `price_delta_cents` entre 0 y 1.000.000.000 —el mismo tope que el precio de un plato—, orden, activa). `organization_id` denormalizado; claves foráneas **compuestas** `(product_id, organization_id)` y `(group_id, organization_id)` (para eso `products` gana `unique (id, organization_id)`): un grupo nunca apunta a un plato ajeno ni una opción a un grupo ajeno. `ON DELETE CASCADE` desde el plato (así `deleteOrg` y los borrados de plato no quedan bloqueados; no hay tablas «solo-agregado» nuevas).
2. **Permisos (ADR 0005/0006):** miembros (Dueño y Staff) leen todo lo de su organización y escriben con `is_org_member` + `org_can_write` (igual que `categories`/`products`: solo lectura y suspendida no escriben, gracia sí). Permisos por columna: se inserta `organization_id, product_id | group_id, …` y se actualiza solo `name, min/max_choices | price_delta_cents, sort_order, is_active`: ni `id`, ni `organization_id`, ni `product_id`/`group_id` se cambian por la API. **Sin DELETE** (desactivar es la baja, como mesas; una baja irreversible subiría el nivel).
3. **Lectura pública (anon):** solo filas activas, de platos activos en categorías activas, con la cuenta publicada (`org_is_published`); una organización inactiva queda oculta por RLS de `categories`. Un miembro ve además lo inactivo de su organización.
4. **Topes técnicos (no de plan):** 20 grupos por plato y 60 opciones por grupo, contando lo inactivo (no hay borrado), con *trigger* y candado de transacción; error `54000` (no `53400`, que es el tope de platos del plan) traducido a mensajes propios. No se tocó `plans`, `org_entitlements` ni suscripciones.
5. **Panel:** sección «Variantes y adicionales» en la pantalla del plato (`/panel/{slug}/carta/platos/{id}`): lista de grupos con regla («Elegí 1», «Opcional · hasta 3»), etiqueta Variante/Adicionales, subir/bajar, activar/desactivar, editar y sus opciones (mismos controles). **Plantillas** «Variante» (Tamaño, 1/1) y «Adicionales» (Adicionales, 0/3) que rellenan el alta, editable. Un grupo activo con menos opciones activas que su mínimo muestra un aviso (y sin opciones activas no se publica). Acciones en `opciones-actions.ts` con los mismos auxiliares (`action-helpers.ts`, extraídos de `actions.ts`): **toda escritura pasa por el mismo `refresh()`**, que invalida la caché de la carta pública (`updateTag(carta:{id})`).
6. **Carta pública:** no existía una pantalla de detalle de plato; los grupos se muestran **bajo cada plato** (nombre del grupo, regla, opciones con «+ $ X»; sin diferencia, nada). Sin títulos nuevos (`h3` sigue siendo solo el plato), filete lateral arena, mismos colores; nombres largos con `overflow-wrap:anywhere`. La carga entra a la caché existente (`option_groups` y `options` leídas con `anon` en la misma función cacheada); la clave pasó a `carta-publica-v2` para no leer entradas con la forma anterior.
7. **Validación (módulo puro `options-rules.ts`):** mínimo y máximo enteros (0–999 de texto, máximo 1–50, mínimo ≤ máximo); diferencia con el parser de precios (es-AR, centavos, tope $ 10.000.000), vacío = 0, negativos rechazados. Errores con lo escrito conservado.
8. **Seed:** Café Ejemplo (Espresso con «Tamaño» y «Extras», más un grupo inactivo, una opción inactiva y un grupo en un plato inactivo que no deben publicarse) y Parrilla Demo (Entraña con «Punto de cocción»).

### A confirmar (decisiones conservadoras tomadas sin poder preguntar)
- **Sin historial de la diferencia de precio de opciones.** `arquitectura.md` anticipaba un *trigger* de `price_history` para opciones; no se hizo: la diferencia es informativa, no cambia `price_cents` ni hay cobro, y extender `price_history` (esquema, ADR 0012) es un cambio aparte. Si el producto quiere auditarla, es ítem propio y probablemente nivel C.
- **Diferencia ≥ 0 (sin descuentos por opción).**
- **Sin borrado** de grupos/opciones (solo desactivar); y tope técnico 20/60 incluyendo lo inactivo.
- **Un grupo sin opciones activas no se muestra** en la carta; uno con menos opciones activas que su mínimo sí se muestra (el panel avisa).
- **Mostrar bajo el plato** en la lista, en vez de una pantalla de detalle aparte (que llegaría con buscador/filtros).
- Plantilla «Adicionales» con máximo 3 por defecto; sin «opción por defecto» ni «obligatoria por plato» más allá del mínimo.

## Nivel
Se mantiene **M**: no cambia ningún precio ya auditado (`price_history` queda intacto), no abre lectura anónima más allá de lo activo y visible (misma cadena que `products`, con prueba), no hay borrado ni dinero cobrado. Lo que lo subiría a C: auditar o cobrar la diferencia, o agregar borrado.

## Aceptación
- [x] Dado el Dueño o el Staff en la pantalla de un plato, cuando crea un grupo (con o sin plantilla) y opciones con diferencia de precio, entonces se ven en el panel con su regla y, **al instante** (caché invalidada), en la carta pública bajo el plato, con «+ $ X» y el precio base intacto.
- [x] Editar, ordenar (subir/bajar), activar y desactivar grupos y opciones persisten y se reflejan en la carta; lo inactivo no se publica.
- [x] Datos inválidos (mínimo > máximo, no entero, diferencia negativa o con 3 decimales, nombre vacío o de más de 80) muestran el error y conservan lo escrito; nada se guarda.
- [x] Aislamiento: otra organización no lee lo inactivo ni escribe; un plato/grupo ajeno responde «no encontrado» o 404; nadie mueve un grupo u opción a otro plato/organización (columnas fijas + claves compuestas).
- [x] Anónimo: solo lo activo, de platos y categorías visibles, con la cuenta publicada; no escribe.
- [x] Solo lectura y suspendida: se ve todo, controles deshabilitados, escrituras forzadas rechazadas sin falso éxito; gracia escribe.
- [x] 390 px sin desborde, también con nombres de 80 caracteres sin espacios y diferencia de $ 10.000.000.

## Fuera de alcance
Pedidos, carrito, stock por opción, opciones por sucursal, precios negativos, borrado, historial de la diferencia, pantalla de detalle propia, etiquetas dietarias, buscador y filtros, límites de plan.

## Evidencia
Ejecutada el 2026-10-16 sobre `pnpm db:reset` (migración `20261019100000_variantes_y_adicionales.sql`) y un `pnpm build` del código final. El commit probado es el de la rama (`git log`); el cierre documental no cambia código.
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK · `pnpm db:types` regenerado.
- `pnpm test` **419/419** (nuevas: `src/lib/carta/options.test.ts` —mínimo/máximo, diferencia, reglas, plantillas, mensajes— y `attachOptions` en `src/lib/menu.test.ts`).
- `pnpm test:rls` **573/573** en 22 archivos. Nuevo `tests/rls/opciones.rls.test.ts` (24): lectura pública (seed; activo/inactivo; plato o categoría inactivos; organización inactiva y suspendida, y en solo lectura sí se publica; anon no escribe), Dueño y Staff, sin DELETE, cascada, aislamiento (lectura, escritura de lo inactivo **y de lo activo/público**, altas cruzadas por clave compuesta, columnas fijas), CHECKs, topes 54000, solo lectura/suspendida/gracia y el módulo `options` con personas reales (sin falsos éxitos). `acl.rls.test.ts` declara las dos funciones *trigger* y las columnas inmutables.
- E2E (build final): `e2e/opciones.spec.ts` **8/8** (flujo del Dueño con plantillas y caché invalidada al instante, Staff, errores con valores conservados, nombres de 80 caracteres sin desborde a 390 px, plato ajeno 404, solo lectura y suspendida, seed). Suite completa: una primera corrida tuvo ~25 fallos de carga (superadmin, sucursales, sala) que pasaron al repetir esos archivos (57/57, más un *worker* caído con `0xC0000409` que pasó al repetir, 15/15); la segunda corrida completa dio 232/235 con 3 `fetch failed` contra Supabase bajo carga (llamado-config, llamados, mesas) que pasaron al repetir esos archivos (58/58).
- **Mutaciones (12 defensas de base rotas de a una, con `opciones` + `acl`):** 11 detectadas y 1 equivalente. Detectadas: insertar opciones y actualizar grupos sin `org_can_write`, lectura de miembros sin membresía, lectura pública de opciones sin `is_active`, de grupos sin plato visible, `GRANT UPDATE` de `group_id` y de `product_id`, `GRANT DELETE`, sin `CHECK` de precio ≥ 0, sin tope de opciones, y **actualizar sin membresía** (esta no se detectaba al principio: se agregó la prueba «lo ACTIVO se lee por ser público, pero no se escribe» y ahora sí). *Equivalente:* quitar `org_is_published` de la política pública de `options`: la cadena por `option_groups` (que sí lo exige, con RLS también en la subconsulta) la sigue ocultando; es defensa en profundidad. La base se restauró con `pnpm db:reset` tras cada mutación.
- Revisión visual a 390 px: carta pública (Espresso del seed) y panel; sin desborde.
- No ejecutado: revisión de Codex (no se pidió; M sin duda); Safari/iOS, lectores de pantalla y teléfono real; carga con más de 1000 filas de opciones por organización (la API corta en 1000; los topes 20/60 por plato lo hacen improbable, sin prueba).

## Aprendizajes
- Un `UPDATE` bloqueado afecta 0 filas sin error (ya sabido): se prueba con lo público y activo, el caso donde la lectura pública «prestaría» visibilidad.
- En grillas y `flex-wrap`, `break-words` no basta: el elemento se ensancha con el texto sin cortes; se usó `space-y` y `min-w-0` + `[overflow-wrap:anywhere]`.
- El desplegable `<details>` del alta de opciones queda abierto tras guardar (para cargar varias seguidas); las pruebas solo lo abren si está cerrado.
- Restos de E2E interrumpidos (organizaciones `e2e-*`) se limpian con `pnpm db:reset`.
