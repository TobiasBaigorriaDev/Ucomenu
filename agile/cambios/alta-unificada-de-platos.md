# Alta unificada de platos

Estado: **commit `03bcba4` en `origin/main` y en staging (Fly v78).** Falta la prueba manual con sesión real. Nivel M.

## Objetivo y aceptación

- Al agregar un plato se pueden cargar los datos, la foto, las variantes y adicionales y los ajustes de sucursales antes de crear. Los datos opcionales se indican como tales.
- Se conserva lo ingresado ante errores, se informa qué falta guardar y se puede continuar sin duplicar el plato, sus grupos ni sus opciones.
- Una respuesta perdida no debe interpretarse como un fallo seguro: se confirma el estado antes de reintentar una creación.
- Se mantienen los permisos, límites, validaciones y reglas de visibilidad existentes.

## Decisiones

- El formulario de «Agregar plato» (`/panel/{org}/carta/platos/nuevo`) trae todo junto: datos, foto, variantes y adicionales (grupos con opciones, con las mismas plantillas del editor) y, con varias sucursales, dónde se muestra y su precio propio. Lo único obligatorio sigue siendo nombre, precio y categoría.
- Foto y grupos viven en el navegador hasta «Crear plato»; viajan en el campo `photo` y en un campo oculto `groups` (JSON). Si el alta falla, el estado del formulario conserva los grupos y la foto se repone en el campo de archivo.
- **Sin duplicados:** todo lo que se puede comprobar sin escribir (foto por bytes y tamaño, grupos, opciones, precios) se valida **antes** de crear (`parseAltaExtras`, `src/lib/carta/alta.ts`). Después de crear el plato, foto, grupos y precios se escriben cada uno por su cuenta (`saveAltaExtras`); lo que falle se informa en el editor (`?pendiente=`, aviso `alta-pendiente`) y se completa ahí. Nunca se vuelve a crear el plato.
- Sigue abierto, sin cambios: si se pierde la respuesta de la creación misma, reintentar puede duplicar el plato (el id lo genera la base). No es una regresión; resolverlo pide una clave de idempotencia con migración.

## Evidencia

- `pnpm test src/lib/carta` (83 pruebas, incluye `alta.test.ts`), `pnpm typecheck`, ESLint sobre `src/app/panel/[org]/carta` y `src/lib/carta`: verdes.
- `pnpm build` y E2E (`carta`, `carta-por-sucursal`, `editor-plato`, `idiomas`): 44 pruebas verdes, con dos nuevas del alta unificada (foto y variantes en un solo envío; error de validación sin crear nada y conservando lo cargado) y el alta por sucursales con precio propio.
- No se corrió RLS (no cambia el esquema ni los permisos: las escrituras usan las mismas funciones y el cliente de la persona). 
- **Staging (2026-10-30):** app desplegada desde una copia limpia de `03bcba4` (`git archive`) con `flyctl deploy -c fly.staging.toml --local-only --depot=false --image-label alta-03bcba4-git` y los cuatro argumentos públicos: **Fly v78**, máquina `78177dda131e38` `started`, 1 control pasando, imagen `registry.fly.io/ucomenu-staging:alta-03bcba4-git`. `/`, `/login`, `/privacidad` y `/m/aurelia/centro` 200, local inexistente 404, `/panel/aurelia/carta/platos/nuevo` sin sesión 307. Sin migraciones. No probado con sesión real (los demos no tienen Dueño). Marcha atrás: `--image registry.fly.io/ucomenu-staging:hoja-a9bbf0b-git` (v77).
- En el mismo despliegue van `66c82d2` (cambiar de idioma conserva la visita de la mesa tras «Reiniciar QR») y `d819881` (botón «Reiniciar QR» junto a «Anotar pedido» en Mesas en vivo).
