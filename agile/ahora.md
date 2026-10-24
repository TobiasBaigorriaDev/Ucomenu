# Ahora (handoff)

Actualizado: 2026-10-24 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**Rama `main`, sin trabajo a medias.** Último commit de código: [estilo «Afiche»](cambios/estilo-afiche.md), en staging (Fly versión 44, migración `20261125100000`). Después, solo herramientas de demostración (`d453c7a`): `tools/sembrar-demo-staging.mjs` carga en staging «La Bestia Burger & Bar» (`/m/la-bestia/centro`, Afiche) y «Aurelia Alta Cocina» (`/m/aurelia/centro`, Minimal), sin Dueño asignado ([ficha](cambios/demo-en-staging.md)). `demo` quedó vacía y de baja: borrarla desde `/admin` a partir del 2026-11-23. `prueba-videos` se borró.

**S3, primer ítem hecho, aprobado y en staging** (C; commit `4ae43da`): [esquema y alta de ítems](cambios/pedidos-esquema-y-alta-de-items.md).

**S3, segundo ítem hecho en local y aprobado por Codex (2 rondas, `c00e838`); falta la aprobación del usuario y staging** (C): [variantes, adicionales y observaciones](cambios/pedidos-variantes-adicionales-observaciones.md). Migración `20261127100000` (reemplaza `add_order_item` por una de siete parámetros, tabla `order_item_options`, `note` y `options_cents`). Verificado: RLS completo salvo un *worker* caído ajeno, repetido en verde; sin pantalla. Siguiente migración libre: `20261128100000`.

## Bloqueos y límites

- **Claves de Supabase de staging**: legacy desactivadas; Fly usa la clave secreta `default` (el CLI la enmascara sin `--reveal`). Falta probar con sesión real SuperAdmin, personal y llamados.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal de comentarios y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`, *workers* `0xC0000409`. E2E con `--workers=3`. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Despliegue desde Windows: `flyctl deploy -c fly.staging.toml` con las cuatro `NEXT_PUBLIC_*` como `--build-arg` (ver `docs/produccion.md`). Los chequeos HTTP de staging usan `/m/la-bestia/centro`.
- Decisión abierta del usuario: el dock de la mesa parte sus etiquetas en dos líneas a 390 px (viene de antes).

## Próximo paso

1. Con la aprobación del usuario: `pnpm exec supabase db push --dry-run` y `db push` de `20261127100000` a staging (la app no cambia; no hace falta desplegar).
2. Tercer ítem de S3 (C): estados de pedido e ítem, modificar y cancelar con registro de solo-agregado; cerrar y anular sin bloqueo por mora.
3. Pendiente urgente: **rotar la `service_role` legacy de staging**. Probar en staging con sesión real: Afiche, SuperAdmin, personal, llamados, promociones y zona horaria.
