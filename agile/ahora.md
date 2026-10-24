# Ahora (handoff)

Actualizado: 2026-10-24 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**Rama `main`, sin trabajo a medias.** Último commit de código: [estilo «Afiche»](cambios/estilo-afiche.md), en staging (Fly versión 44, migración `20261125100000`). Después, solo herramientas de demostración (`d453c7a`): `tools/sembrar-demo-staging.mjs` carga en staging «La Bestia Burger & Bar» (`/m/la-bestia/centro`, Afiche) y «Aurelia Alta Cocina» (`/m/aurelia/centro`, Minimal), sin Dueño asignado ([ficha](cambios/demo-en-staging.md)). `demo` quedó vacía y de baja: borrarla desde `/admin` a partir del 2026-11-23. `prueba-videos` se borró.

**S3, primer ítem hecho, aprobado y en staging** (C; commit `4ae43da`): [esquema y alta de ítems](cambios/pedidos-esquema-y-alta-de-items.md).

**S3, segundo ítem hecho, aprobado y en staging** (C; `c00e838`): [variantes, adicionales y observaciones](cambios/pedidos-variantes-adicionales-observaciones.md).

**S3, tercer ítem hecho, aprobado por Codex (2 rondas) y por el usuario, y migrado a staging** (C; `367ca22`): [estados, modificar, cancelar, cerrar y anular, con registro](cambios/pedidos-estados-y-registro.md). Migración `20261128100000` (cuatro funciones, tabla `order_events` de solo-agregado con su purga en `admin_delete_organization`). Siguiente migración libre: `20261129100000`.

## Bloqueos y límites

- **Claves de Supabase de staging**: legacy desactivadas; Fly usa la clave secreta `default` (el CLI la enmascara sin `--reveal`). Falta probar con sesión real SuperAdmin, personal y llamados.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal de comentarios y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`, *workers* `0xC0000409`. E2E con `--workers=3`. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Despliegue desde Windows: `flyctl deploy -c fly.staging.toml` con las cuatro `NEXT_PUBLIC_*` como `--build-arg` (ver `docs/produccion.md`). Los chequeos HTTP de staging usan `/m/la-bestia/centro`.
- Decisión abierta del usuario: el dock de la mesa parte sus etiquetas en dos líneas a 390 px (viene de antes).

## Próximo paso

1. Cuarto ítem de S3 (M): vista «Mesas» en la Sala (pedido abierto + llamados por mesa) y total en «Pedir la cuenta».
2. Pendiente urgente: **rotar la `service_role` legacy de staging**. Probar en staging con sesión real: Afiche, SuperAdmin, personal, llamados, promociones y zona horaria.
