# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Cuarta tanda (UX, nivel M) implementada y probada en local con emulación de teléfono; falta la aprobación del usuario.** Rama `main`. [Ficha](cambios/detalle-retorno-y-confirmaciones.md). Sin migración ni cambios de base.

1. Detalle del plato: «Volver a la carta» queda fijo arriba y el scroll no pasa a la página de atrás.
2. Textos legales: «Volver» (o «Ir a la portada» con acceso directo), sin guardar nada ni agregar parámetros.
3. Sumar un Dueño: el hallazgo (cuenta y locales) va antes de la casilla; «Cancelar y cambiar el email» no escribe ni recarga.
4. Sala con varias sucursales: el anuncio y «Atendido» nombran la sucursal; una sola región viva.

Esperan aprobación humana, además de esta: la tanda 3 ([formularios, cuenta y mensajes](cambios/formularios-cuenta-y-mensajes.md), `1ea4ca6`), la 2 ([listas, orden e imágenes atómicos](cambios/orden-e-imagenes-atomicos.md), ADR 0033, migración `20261105100000`), la 1 ([cuentas globales](cambios/proteger-cuentas-globales.md), ADR 0032, migración `20261104100000`) y el [borrado de mesas](cambios/borrado-de-mesas.md). Las tandas 1 y 2 están aprobadas por Codex; staging no tiene esas migraciones. Fase 2 = feed de videos con **Mux Video** ([ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal).
- Siguen con paginación por offset: carta pública, idiomas, sucursales, opciones de un plato y disponibilidad (ver la ficha de la tanda 2).
- No hay `global-error.tsx`: un error del layout raíz usa la pantalla por defecto de Next.
- Flaky conocido: en RLS completo, `owner-lectura` choca a veces con otro archivo que toca `audit_log`, y un worker puede caer con `0xC0000409`. Se repiten una vez.
- E2E con `--workers=1`; RLS y E2E no a la vez.

## Próximo paso

1. El usuario aprueba; recién entonces subir a `origin`, aplicar las migraciones pendientes en staging y desplegar.
2. Probar en un teléfono real (iPhone y Android) el detalle del plato con la barra de direcciones móvil, el «Volver» de los textos legales y la sala con dos sucursales.
