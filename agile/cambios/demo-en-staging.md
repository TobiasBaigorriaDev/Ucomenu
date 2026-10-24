# Cambio: carta de demostración en staging

Estado: **Hecho** (2026-10-17; cargada en staging por pedido del usuario). Nivel **S/M**: herramienta de demostración, datos y fotos ficticios, sin cambios de esquema ni de la aplicación.

> **Actualización (2026-10-24):** a pedido del usuario, `demo` («Café Demo») y `prueba-videos` salieron de staging y `tools/sembrar-demo-staging.mjs` carga ahora **dos locales nuevos** definidos en `tools/demo/locales-staging.mjs`: «La Bestia Burger & Bar» (`/m/la-bestia/centro`, Afiche + Carbón, 25 platos, 22 con foto) y «Aurelia Alta Cocina» (`/m/aurelia/centro`, Minimal + Borgoña, 25 platos, 23 con foto). `prueba-videos` se borró entera (con su asset de Mux); `demo` quedó **vacía y de baja** porque su historial de promociones solo se purga con el borrado oficial (30 días de baja): borrarla de `/admin` a partir del 2026-11-23. Se borraron además sus 2 assets de Mux. Sin Dueño asignado: sumarlo desde SuperAdmin. El resto de esta ficha describe la herramienta original.

## Qué es
Una organización propia, `demo` («Café Demo», sucursal `centro`, `/m/demo/centro`), con 6 categorías, 26 platos (24 con foto), variantes y adicionales, etiquetas dietarias, un plato agotado, 4 mesas, logo y plan Pro vigente por unos 700 días (para que no caduque como la prueba de 14 días). No toca ninguna otra organización.

## Herramientas
- `tools/demo/catalogo.mjs`: el catálogo (fotos de Unsplash, platos, logos sintéticos) extraído de `tools/sembrar-demo.mjs`, que sigue siendo solo para el Supabase local (`pnpm db:demo`, comprobado tras la extracción).
- `tools/sembrar-demo-staging.mjs`: carga o quita la demo. Idempotente. Protecciones: exige `--proyecto <ref>` y que la URL sea exactamente `https://<ref>.supabase.co`; `--prueba-local` solo vale con el Supabase local (para ensayarla). Las credenciales van por entorno, nunca por archivo ni argumento.
```bash
REF=<referencia del proyecto de staging>   # supabase/.temp/project-ref
KEY=$(pnpm exec supabase projects api-keys --project-ref "$REF" -o json | <extraer service_role>)   # solo en memoria
NEXT_PUBLIC_SUPABASE_URL="https://$REF.supabase.co" SUPABASE_SERVICE_ROLE_KEY="$KEY" node tools/sembrar-demo-staging.mjs --proyecto "$REF"            # carga
... node tools/sembrar-demo-staging.mjs --proyecto "$REF" --quitar                                                                                      # quita catálogo, fotos y logo
```
- La organización se crea **sin ninguna cuenta**: quien quiera editarla se suma como Dueño desde SuperAdmin («Sumar un Dueño»). La escritura va con la clave de servicio y no deja filas en `audit_log` (no es un alta de cliente).

## Costo y límites
Unos 3,5 MB de fotos (de 1 GB de almacenamiento del plan Free), unas pocas filas, ningún cambio en Fly. Con 26 platos entra en cualquier plan (Básico permite 80 activos, Pro 200).

## Evidencia
Ensayo completo contra el Supabase local (`--prueba-local`): carga, segunda corrida idempotente (mismos 26 platos, 24 fotos, 25 archivos de almacenamiento) y `--quitar` (queda en 0); las tres protecciones rechazan proyecto distinto, URL local sin `--prueba-local` y `--prueba-local` con URL remota. En staging: `/m/demo/centro` responde 200 con 26 platos, 24 fotos distintas (una cargada vía el optimizador de imágenes con 200) y el logo. Para producción **no** se usa sin una decisión aparte (datos reales de clientes).
