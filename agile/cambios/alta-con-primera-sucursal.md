# Cambio: el alta de SuperAdmin crea también la primera sucursal
Estado: implementado y verificado en local (2026-10-16), sin subir
Nivel: M (el tablero lo anotaba como S; sube porque cambia una función de base del SuperAdmin y su migración. No cambia permisos, dinero ni borrados, así que no es C)

## Objetivo
Una organización recién creada en `/admin/nueva` tenía carta pública 404 hasta que alguien creaba su sucursal por script (el panel todavía no gestiona sucursales). Ahora el alta crea la **primera sucursal** y la carta se abre desde el primer momento.

## Decisiones (mías; revierten el punto 4 de la ficha `superadmin-alta-de-organizaciones.md`, «Sin sucursal inicial», que era provisorio hasta tener gestión de sucursales)
1. **Dos campos nuevos obligatorios en el formulario:** nombre de la sucursal e identificador (slug, propuesto `principal`). El slug va en la dirección pública `/m/{org}/{sucursal}`; los QR no dependen de él.
2. **La sucursal se crea dentro de `admin_create_organization`**, en la misma transacción que la organización, la suscripción, el Dueño y la auditoría. Si algo falla no queda nada.
3. **Parámetros opcionales al final** (`p_branch_slug`, `p_branch_name`, con `null` por defecto): las llamadas viejas a la función siguen valiendo y crean la organización sin sucursal. La aplicación siempre los envía. O los dos o ninguno (`22023 invalid_branch`).
4. **La auditoría registra la sucursal** dentro del mismo `after` (`branch: {slug, name}`).
5. Los permisos de la función no cambian: solo `service_role`. La sucursal pasa por el trigger de límites del plan (todos admiten al menos una).

## Aceptación
- [x] Con nombre y slug válidos, existe la sucursal de la organización y `/m/{org}/{sucursal}` responde 200.
- [x] Nombre vacío o de más de 80 caracteres y slug inválido o vacío dan error claro y no dejan nada (ni cuenta de Auth ni organización).
- [x] La base valida por sí sola (slug mal formado, nombre en blanco, solo uno de los dos): rollback completo.
- [x] La auditoría tiene una sola fila por alta, con la sucursal.
- [x] Sin sucursal (llamada directa vieja) el alta sigue funcionando.

## Evidencia (2026-10-16, sobre el diff sin commitear de este cambio; `pnpm db:reset` previo)
`pnpm typecheck` · `pnpm lint` · `pnpm test` 281/281 · `pnpm test:rls admin.rls acl.rls` 69/69 (nuevas: sucursal creada, auditoría, 4 casos de rollback en la base, alta sin sucursal, 4 casos de validación) · `pnpm build` · `playwright e2e/superadmin.spec.ts` 15/15 (nueva: slug propuesto e inválido; el alta ahora abre la carta pública). No se hicieron mutaciones: el invariante (todo o nada) lo cubre la prueba de rollback, que ejecuta la función real.

## Migración y rollback
`20261016120000_alta_con_primera_sucursal.sql`: reemplaza la función (drop + create) con el mismo permiso. Rollback documentado en la migración. No toca datos.
