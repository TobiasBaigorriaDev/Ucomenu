# Cambio: buscador y filtros dietarios en la carta pública

Estado: implementado y verificado en local. Revisión independiente pendiente, elegida manualmente por el usuario; sin integrar ni desplegar.
Nivel: **M de producto, C técnico** por ampliar los permisos de columna del catálogo.

## Decisiones y alcance
- Sin dependencias nuevas ni cambios de identidad visual. Búsqueda local por nombre y descripción, insensible a mayúsculas y acentos; varias palabras deben coincidir.
- Etiquetas cerradas declaradas por el local: Sin TACC, Vegano y Vegetariano. No se deducen de ingredientes ni de otras etiquetas. Varias seleccionadas exigen todas; se combinan con la búsqueda.
- Alta y edición de etiquetas en Datos del plato, para Dueño y Staff con la cuenta editable. Vacío significa sin declaración, nunca una certificación.
- Detalle del plato en una ficha superpuesta accesible, conservando búsqueda, filtros, mesa y barra de llamado al volver. Foto, descripción, precio base, etiquetas y opciones informativas.
- Migración aditiva; mismos roles, RLS y restricciones por mora de products. Se cambia la versión de caché y se usa la invalidación existente.
- El catálogo global inicialmente bosquejado se simplifica a tres declaraciones cerradas en el plato, sin administración global nueva: [ADR 0016](../../docs/decisiones/0016-etiquetas-y-disponibilidad-de-carta.md).

## Aceptación
- [x] Dueño y Staff guardan etiquetas válidas; se conservan ante errores y aparecen en la carta directa y por QR.
- [x] Búsqueda, combinación de filtros, contador, limpiar y estado sin resultados funcionan; desaparecen categorías vacías y no hay enlaces a secciones ausentes.
- [x] Ficha de detalle abre y cierra con teclado; restaura foco y conserva el contexto de la carta.
- [x] Sin afirmaciones sobre platos sin etiquetar; aviso de alérgenos visible.
- [x] Base rechaza etiquetas fuera del conjunto y nulas; ajenos y anónimos no escriben; solo lectura/suspensión bloquean y lo inactivo no se publica.
- [x] Móvil y escritorio sin desborde; comprobaciones pertinentes y diff revisado.

## Invariantes, fallos y recuperación
No se amplían organizaciones visibles ni se modifica precio, límites o publicación. La escritura usa el cliente de la persona y confirma filas afectadas. Error de lectura no entrega resultados parciales. Revertir código y retirar la columna/permisos mediante una migración revisada; no ejecutar retirada con datos sin respaldo. En local descartable, restaurar desde migraciones y seed.

## Evidencia
Diff probado: unidad de búsqueda/etiquetas que incorpora este documento, sobre `dc4d102`, rama `feat/busqueda-y-disponibilidad`.
- `pnpm test`: **436/436**; focalizadas previas: **65/65**.
- `pnpm test:rls tests/rls/dietary.rls.test.ts tests/rls/carta.rls.test.ts tests/rls/acl.rls.test.ts`: **38/38**.
- `pnpm exec playwright test e2e/buscador.spec.ts e2e/menu.spec.ts e2e/opciones.spec.ts --workers=2`: **25/25**. Después de corregir el singular del contador y ampliar la prueba de conservación ante error, build nuevo + `e2e/buscador.spec.ts --workers=1`: **1/1**.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` y `git diff --check`: correctos. Inspección visual de capturas a 390 y 1280 px: sin defectos detectados.
- Base local existente: `pnpm db:start`, migración aditiva con `supabase migration up --local` y `pnpm db:types`. **No se ejecutó db:reset** para preservar el estado de la prueba manual del usuario; las pruebas nuevas usan organizaciones propias. Cambios de seed revisados, sin resembrar.
- La entrega conjunta con disponibilidad registra la comprobación completa y las correcciones de integración en [su ficha](disponibilidad-por-sucursal.md). Revisión independiente y aprobación humana C pendientes; no se invocaron otros agentes. Sin cambios remotos ni despliegue.

Límite de reversión: esta unidad completa (columna, formularios, búsqueda y detalle); la disponibilidad es otra unidad. La retirada SQL con datos requiere revisión y respaldo. Tamaño autoral mayor a 400 líneas: se mantiene la unidad funcional local; al abrir PR, separar contratos de persistencia y experiencia de carta en una cadena revisable, sin recortar pruebas.
