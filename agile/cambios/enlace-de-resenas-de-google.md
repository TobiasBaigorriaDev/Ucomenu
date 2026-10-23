# Cambio: Enlace de reseñas de Google por sucursal
Estado: **implementado y verificado en local (2026-10-23).** Primera pieza del módulo 9 de [producto](../../docs/producto.md) (la invitación en la carta es el ítem siguiente y depende de este).
Nivel: **M** — una columna y un privilegio por columna; no toca dinero, planes ni borrados. El único riesgo de exposición es que el enlace lo lee la carta pública, así que se acota a direcciones de Google.

## Objetivo
Que el Dueño cargue, por sucursal, el enlace de reseñas de su perfil de Google, para que después la carta pueda invitar a reseñar. Esta ficha solo guarda y valida el dato; **no cambia la carta pública**.

## Decisiones (particulares)
1. **Columna `branches.google_review_url`** (nula = sin enlace), migración `20261120100000`. `CHECK`: `https`, host **exacto** de una lista de Google (`g.page`, `g.co`, `goo.gl`, `maps.app.goo.gl`, `share.google`, `search.google.com`, `maps.google.com`, `google.com`, `www.google.com`, `google.com.ar`, `www.google.com.ar`), después del host solo `/…` (sin usuario, sin puerto, sin `?`/`#` pegados al host), sin espacios, caracteres de control ni barras invertidas, de 1 a 500 caracteres. Ampliar la lista es una migración.
2. **Misma lista en la aplicación** (`GOOGLE_REVIEW_HOSTS` y `REVIEW_URL_PATTERN` en `rules.ts`) para dar un mensaje claro antes de escribir; la base sigue siendo la autoridad. Una tabla de casos compartida (`resenas-casos.ts`) la recorren la prueba unitaria y la de RLS, así que la validación local y el `CHECK` no se pueden desviar sin que una falle.
3. **Solo el Dueño la edita**: `grant update (google_review_url)` a `authenticated` y la política vigente de UPDATE de `branches` (Dueño y cuenta al día: en solo lectura o suspendida no se escribe). El Staff, otras organizaciones y `anon` no pueden. No se agregó ninguna política ni función.
4. **Lectura pública** por el SELECT que ya tenían `anon` y `authenticated`, filtrado por la política de sucursales activas y publicadas: una sucursal desactivada, una cuenta suspendida o una organización dada de baja no exponen el enlace.
5. **Pantalla**: en Sucursales (solo Dueño), un renglón «Enlace de reseñas: …» o «Sin enlace de reseñas de Google» y un formulario plegado «Enlace de reseñas». Vacío lo quita. No se verifica que el enlace exista ni que abra la página de reseñas (no se hacen pedidos a Google).
6. **No se acepta cualquier subdominio de Google** (`accounts.google.com`, `docs.google.com`…): solo los hosts de la lista, por los que se publican perfiles y reseñas.

## Aceptación
- [x] El Dueño guarda, cambia y quita el enlace de cada sucursal; se guarda tal cual (sin espacios de los bordes) y vacío lo vuelve nulo.
- [x] Un enlace que no es https de Google (otro dominio, `http`, usuario o puerto, subdominio de Google fuera de la lista, espacios, barra invertida, más de 500 caracteres) se rechaza con un mensaje claro, también si se salta la validación local (`23514`).
- [x] La validación local y el `CHECK` responden lo mismo a cada fila de la tabla de casos.
- [x] El Staff, el Dueño de otra organización y `anon` no lo escriben; con la cuenta en solo lectura o suspendida, tampoco el Dueño.
- [x] La carta pública lo lee solo mientras la sucursal está activa y publicada.

## Evidencia
Migración `20261120100000`, sobre el diff de `main` (2026-10-23):
- `pnpm db:reset` y `pnpm db:types`; `pnpm typecheck`, `pnpm lint` y `pnpm build` en verde.
- RLS: `enlace-de-resenas` 10/10 (paridad del `CHECK` y la validación local con 32 casos; escritura del Dueño, del Staff, de otra organización y de `anon`; cuenta en solo lectura y suspendida; lectura pública con sucursal desactivada, cuenta suspendida y organización dada de baja).
- Unitarias de `rules` y mensajes en verde. E2E `sucursales` 16/16 con la prueba nueva (guardar, rechazar uno ajeno conservando lo escrito, quitar; sin desborde a 390 px).
- Sin probar: staging y teléfono real. La carta pública todavía no muestra el enlace.

## Fuera de alcance
La invitación en la carta (pie y «Pedir la cuenta»), sus textos es/en/pt y el cierre diario; comprobar que el enlace abre una página de reseñas; enlaces de otros sitios (TripAdvisor, etc.).
