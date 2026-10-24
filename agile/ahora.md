# Ahora (handoff)

Actualizado: 2026-10-24 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**Rama `main`, sin trabajo a medias.** Último commit de código: [estilo «Afiche»](cambios/estilo-afiche.md), en staging (Fly versión 44, migración `20261125100000`). Después, solo herramientas de demostración (`d453c7a`): `tools/sembrar-demo-staging.mjs` carga en staging «La Bestia Burger & Bar» (`/m/la-bestia/centro`, Afiche) y «Aurelia Alta Cocina» (`/m/aurelia/centro`, Minimal), sin Dueño asignado ([ficha](cambios/demo-en-staging.md)). `demo` quedó vacía y de baja: borrarla desde `/admin` a partir del 2026-11-23. `prueba-videos` se borró.

**S3, primer ítem hecho, aprobado por Codex (3 rondas) y por el usuario, y migrado a staging** (C; commit `4ae43da`): [esquema de pedidos y alta de ítems sin opciones](cambios/pedidos-esquema-y-alta-de-items.md). Migración `20261126100000` (`orders`, `order_items`, `add_order_item`, función de plan `orders` en Pro y Premium). Verificado: RLS completo 1302/1302, 25 pruebas nuevas, 7 mutaciones detectadas, typecheck y lint limpios; falla ajena de siempre en `textos.test.ts`. Sin pantalla. Siguiente migración libre: `20261127100000`.

## Bloqueos y límites

- **Claves de Supabase de staging**: legacy desactivadas; Fly usa la clave secreta `default` (el CLI la enmascara sin `--reveal`). Falta probar con sesión real SuperAdmin, personal y llamados.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal de comentarios y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`, *workers* `0xC0000409`. E2E con `--workers=3`. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Despliegue desde Windows: `flyctl deploy -c fly.staging.toml` con las cuatro `NEXT_PUBLIC_*` como `--build-arg` (ver `docs/produccion.md`). Los chequeos HTTP de staging usan `/m/la-bestia/centro`.
- Decisión abierta del usuario: el dock de la mesa parte sus etiquetas en dos líneas a 390 px (viene de antes).

## Próximo paso

1. Segundo ítem de S3 (C): variantes, adicionales y observaciones con validación de mínimos y máximos (levanta `options_required`).
2. Pendiente urgente: **rotar la `service_role` legacy de staging**. Probar en staging con sesión real: Afiche, SuperAdmin, personal, llamados, promociones y zona horaria.
