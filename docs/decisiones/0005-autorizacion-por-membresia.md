# 0005 — Autorización por membresía en la base, con permisos por columna

- Estado: aceptada
- Fecha: 2026-10-14

## Contexto
El ADR 0004 fija que el aislamiento entre organizaciones lo garantiza la base con RLS. Falta decidir **de dónde sale la identidad de pertenencia y rol**, quién puede crear membresías y cómo se evita que un usuario autorizado en dos organizaciones mueva datos de una a otra.

## Decisión
1. **Fuente única: la tabla `memberships`** (usuario, organización, rol `owner` | `staff`). Las políticas la consultan en cada pedido mediante `private.is_org_member(org)` y `private.is_org_owner(org)`. **No se autoriza con el JWT ni con `user_metadata`**: este último lo edita el propio usuario, y un claim en el token sigue vigente hasta que vence aunque se quite la membresía.
2. **Funciones auxiliares en el esquema `private`**, no expuesto por la Data API. Son `SECURITY DEFINER` con `search_path` vacío (única forma de leer `memberships` con RLS desde las políticas sin recursión), sin `EXECUTE` para `public` ni `anon`; solo `authenticated`.
3. **Las membresías, organizaciones y sucursales se crean y borran solo desde el servidor** (`service_role`). Ningún rol de la API puede escribir `memberships`: así no hay escalada de privilegios.
4. **Permisos por columna** (`GRANT INSERT/UPDATE (columnas)`): `organization_id`, `id`, `created_at` y `currency` no se pueden elegir ni cambiar por la API; `slug` e `is_active` de organizaciones y sucursales tampoco. Es la barrera que impide que un miembro de A y B mueva filas entre ambas (las políticas solas lo permitirían).
5. La carta (`categories`, `products`) la gestionan `owner` y `staff` de su organización; el nombre de organización y sucursal, solo el `owner`.

## Alternativas consideradas
- **Claims en el JWT (`app_metadata`) con la membresía** — evita una consulta por pedido, pero la revocación demora hasta que se renueva el token. Se descarta por seguridad; el costo de la consulta es bajo con el índice de `(user_id, organization_id)`.
- **Políticas con subconsulta directa a `memberships`** — evita `SECURITY DEFINER`, pero cae en recursión de RLS en la propia tabla y repite lógica en cada política.
- **Dejar que el owner gestione membresías por la API** — comodidad a cambio de una superficie de escalada; se hará con una función validada cuando exista «Acceso del personal».

## Consecuencias
- Cada tabla de negocio nueva debe sumar sus políticas con estas funciones **y** sus grants por columna, más pruebas de matriz entre dos organizaciones y una mutación.
- Un `UPDATE`/`DELETE` fuera de la organización no falla: afecta 0 filas. La aplicación debe tratar «0 filas» como «no permitido o inexistente».
- Resuelto después: límites de plan y mora en las escrituras (ADR 0006) y la regla «una organización no se queda sin owner» con la gestión del personal desde el servidor (ADR 0007, que reemplaza la idea de «una función validada» por un módulo de servidor con el invariante en la base).
