# Cambio: Invitación a reseñar en la carta
Estado: **implementado, verificado en local y desplegado en staging (2026-10-23).** Segunda pieza del módulo 9 de [producto](../../docs/producto.md); usa el dato de la [ficha del enlace](enlace-de-resenas-de-google.md).
Nivel: **M** — solo lectura pública de un dato ya acotado a Google y dos piezas de interfaz; sin migración, dinero, permisos ni borrados.

## Objetivo
Que la carta invite a dejar una reseña en Google cuando la sucursal tiene enlace: un enlace discreto en el pie y, con plan Pro o superior, una invitación tras «Pedir la cuenta».

## Decisiones (particulares)
1. **Sin migración**: el enlace llega por la consulta en vivo de la sucursal que ya hacía `getPublicMenu` (no entra en la caché de la carta, así que quitarlo o cambiarlo se ve de inmediato). La carta lo vuelve a comprobar contra la lista de Google (`publicReviewUrl`) antes de ponerlo en un `href`: segunda barrera tras el `CHECK`.
2. **Pie para todos los planes**: «Dejá tu reseña en Google» en `/m/…` y `/t/…`, con `target="_blank"` y `rel="noopener noreferrer"`. Sin enlace cargado no se dibuja nada.
3. **Tras «Pedir la cuenta» solo con Pro o superior sin comprobar el plan en la app**: el dock de llamados solo existe si la base informa `calls_enabled` (función `waiter_call`, Pro y Premium); la invitación vive en ese dock, así que hereda la regla y no hay otra lectura de plan que se pueda desviar. Se ofrece también desde el dock del feed (`/t/{token}/videos`).
4. **Solo cuando la cuenta se registró** (`created`): no tras «Llamar al mozo», ni con «ya pedimos» o espera, ni con error.
5. **Una vez al día por dispositivo y sucursal**: se marca en `localStorage` (clave `ucomenu:resenas:{sucursal}`, día del dispositivo) la primera vez que se ofrece; cerrar la oculta. Sin almacenamiento disponible se ofrece sin recordar. Es una cortesía de interfaz, no una regla de seguridad.
6. **Textos fijos es/en/pt** (`TEXTOS.*.review`), iguales para todos y no editables por el local. Neutros: sin preguntar si le gustó, sin estrellas, sin incentivos ni presión, conforme a la política de Google. La prueba de textos ya exige paridad de claves entre idiomas.

## Aceptación
- [x] Con enlace, el pie lo ofrece en cualquier plan; sin enlace no aparece nada.
- [x] Con Pro, pedir la cuenta muestra la invitación con el enlace; «Llamar al mozo» no.
- [x] Se puede cerrar y no vuelve a aparecer ese día en el dispositivo (ni en otra mesa de la sucursal).
- [x] Sin desborde horizontal a 390 px y botón de cierre de 44 px o más.
- [x] Un valor guardado que no cumpla la lista de Google no llega a la carta.

## Evidencia
Commits `fec2870` y `468988d` (2026-10-23):
- `pnpm typecheck` y `pnpm lint` en verde; `pnpm build` correcto.
- Unitarias de `sucursales` en verde (incluye `publicReviewUrl` contra la tabla de casos compartida). En `idiomas` solo falla la prueba ajena de siempre (`feed.dockLink`, «Menufeed»).
- E2E contra el build: `resenas-carta` (3 pruebas nuevas), `llamados`, `idiomas` y `carta`: 53 de 53.
- Staging (2026-10-23): `origin/main` en `468988d`; Fly `ucomenu-staging` versión 35 (imagen de Docker con `--remote-only`, árbol confirmado). Sin migración. `/`, `/login`, `/terminos` y `/privacidad` responden 200 y `/admin` redirige al login. Sin probar la invitación con un local Pro, un enlace cargado ni un teléfono real.

## Fuera de alcance
Comprobar que el enlace abre la página de reseñas; medir clics; otros sitios de reseñas; editar los textos por local.
