# Ahora (handoff)

Actualizado: 2026-10-24 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**S3 «Pedidos del mozo»:** base de datos en staging ([esquema](cambios/pedidos-esquema-y-alta-de-items.md), [opciones](cambios/pedidos-variantes-adicionales-observaciones.md), [estados](cambios/pedidos-estados-y-registro.md); migración `20261128100000`; siguiente libre: `20261129100000`) y [vista «Mesas»](cambios/sala-mesas-y-total.md) (Fly 46).

**Quinto ítem desplegado en staging, Fly versión 47** (M): [pantalla «Anotar»](cambios/sala-anotar-pedido.md) sobre `add_order_item` (commit `1b217a4`). Falta probarlo con sesión real en staging.

**Sexto ítem desplegado en staging, Fly versión 48** (M): [operar el pedido](cambios/sala-operar-pedido.md) (commit `73badde`). Falta probar «Anotar» y «Operar» con sesión real en staging.

**Ficha de cierre, hecha en local y sin subir** (commits locales `9fcc707`…): [precuenta](cambios/sala-precuenta.md) (M, sin migración: `/sala/{slug}/cuenta/{pedido}`, imprimible) y [retención de pedidos](cambios/retencion-de-pedidos.md) (C: migración `20261129100000`, `purge_expired_orders`, 2 años, por lotes, solo `service_role`, sin programar; [ADR 0043](../docs/decisiones/0043-retencion-de-pedidos.md)). Codex revisó la purga en 3 rondas (interbloqueo y lotes corregidos; la tercera fue un cambio de requisito que el usuario resolvió: sin registro de conteos). **Falta:** aprobación del usuario, subir a `origin`, aplicar la migración en staging (`supabase db push`, pide aprobación) y desplegar la precuenta.

Local: `cafe-ejemplo` quedó en plan Pro en la base local (`pnpm db:reset` lo restaura).

Demo en staging: `/m/la-bestia/centro` (Afiche) y `/m/aurelia/centro` (Minimal), sin Dueño asignado ([ficha](cambios/demo-en-staging.md)). `demo` quedó vacía y de baja: borrarla desde `/admin` desde el 2026-11-23.

## Bloqueos y límites

- **Claves de Supabase de staging**: legacy desactivadas; Fly usa la clave secreta `default` (el CLI la enmascara sin `--reveal`). Falta probar con sesión real SuperAdmin, personal y llamados.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal de comentarios y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`, *workers* `0xC0000409`; con muchos archivos E2E a la vez `sala.spec` falla por carga. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Decisión abierta del usuario: el dock de la mesa parte sus etiquetas en dos líneas a 390 px (viene de antes).

## Próximo paso

1. Aprobar y subir la ficha de cierre; migración en staging y despliegue; después probar «Anotar», «Operar» y la precuenta en staging con un local Pro con Dueño (los demos no tienen).
2. Después: programar la purga (pg_cron, `docs/produccion.md` 4.c) en la salida a producción y confirmar el plazo con el contador; analítica de pedidos (opcional). Falta que desde «Mesas» se llegue a una mesa con pedido abierto cuando el plan ya no incluye los pedidos (hoy solo por URL). Pendiente urgente: **rotar la `service_role` legacy de staging**.
