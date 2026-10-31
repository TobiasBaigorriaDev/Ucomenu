# Cambio: Precio de la suscripción visible para el Dueño
Estado: en `origin/main` (`104004c`) y desplegado en staging (Fly v86)
Nivel: M (solo muestra el precio de lista del catálogo y lo que `org_entitlements` ya entrega al Dueño; no cobra, no cambia planes, límites ni permisos; sin migración)

## Objetivo
`/panel/{slug}/suscripcion` decía plan, ciclo y vencimiento, pero no cuánto cuesta. El Dueño ve arriba «Lo que pagás»: el precio por mes o por año según su ciclo.

## Decisiones
- **Precio de lista, no lo cobrado:** el plan sale del catálogo (`plans`, en USD, de lectura con sesión: `authenticated` ya tiene SELECT) según plan y ciclo. Lo que se cobró de verdad (importe y moneda del cobro manual) sigue en «Pagos»; la celda lo dice en una nota y muestra el último pago vigente.
- **Dos monedas, sin sumar:** el plan va en USD y las sucursales adicionales (ADR 0039) en ARS por mes, cada una en su línea; no hay tipo de cambio acá y no se inventa un total.
- **Prueba gratuita:** «Sin costo durante la prueba» y, debajo, lo que sigue después. **Sin ciclo conocido y fuera de la prueba no se muestra precio** (no se adivina).
- Solo el Dueño (la página ya exige `requireOwner`). Sin dependencias ni cambios de esquema. Lógica pura en `src/lib/cuenta/precio.ts`.

## Aceptación
- [x] Plan mensual: «US$ 40 USD por mes»; anual: «US$ 380 USD por año» (valores del catálogo local).
- [x] Con sucursales adicionales, una línea aparte en ARS por mes con la cantidad en singular o plural.
- [x] En la prueba gratuita no cuesta nada y avisa el precio posterior.
- [x] El último pago vigente aparece solo en la primera página de pagos.
- [x] El Personal no ve ningún precio; 390 px sin desborde.

## Fuera de alcance
Cambiar precios o moneda del catálogo (hoy el catálogo está en USD y la portada vende en ARS: el contraste está pendiente en el tablero, «precios de portada contra el catálogo»), tipo de cambio, facturas, cambio de plan desde el panel.

## Evidencia (2026-10-31, árbol sin commit)
- `pnpm test` completo, `pnpm typecheck` y `pnpm lint`: correctos (nuevas: `src/lib/cuenta/precio.test.ts`).
- E2E nuevo `e2e/suscripcion-precio.spec.ts` (4/4) junto con `cuenta-pagos-historial` (6/6 en conjunto).
- Visto en pantalla con el local Aurelia (Pro anual) a escritorio y a 390 px.
- **No ejecutado:** pruebas RLS (no hay cambio de base; `plans` ya era de lectura con sesión, lo cubre `acl.rls.test.ts`).
- Recuperación: revertir el incremento.
- **Staging (2026-10-31, aprobado por el usuario):** Fly **v86** `complete`, máquina `78177dda131e38` sana, imagen `registry.fly.io/ucomenu-staging:resumen-104004c-git` (copia limpia de `104004c`; sin migraciones). `/`, `/login` y `/m/aurelia/centro` 200, local inexistente 404, `/panel/aurelia` y `/panel/aurelia/suscripcion` sin sesión 307. **No probado:** la pantalla con sesión real en staging. Marcha atrás: `flyctl deploy -c fly.staging.toml --image registry.fly.io/ucomenu-staging:<etiqueta de la v85>`.
