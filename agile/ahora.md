# Ahora (handoff)

Actualizado: 2026-10-24 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**S3 «Pedidos del mozo»:** los tres primeros ítems son solo base de datos, aprobados y **en staging**: [esquema](cambios/pedidos-esquema-y-alta-de-items.md), [opciones](cambios/pedidos-variantes-adicionales-observaciones.md) y [estados y registro](cambios/pedidos-estados-y-registro.md) (migración `20261128100000`). Siguiente migración libre: `20261129100000`. El cuarto, [vista «Mesas»](cambios/sala-mesas-y-total.md), está desplegado en staging (Fly versión 46).

**Quinto ítem hecho en local, sin commitear** (M): [pantalla «Anotar»](cambios/sala-anotar-pedido.md): `/sala/{slug}/mesas/{mesa}/anotar`, con la carta de la sucursal, panel de plato (cantidad, variantes, adicionales, observación) y la acción `addOrderItemAction` sobre `add_order_item`. Sin migración. Pruebas verdes (unitarias, RLS 9/9, E2E 6/6). **Falta:** aprobación del usuario, commit, despliegue a staging y probarlo con sesión real.

Archivos nuevos: `src/app/sala/[org]/mesas/[mesa]/anotar/`, `src/lib/sala/anotar*.ts`, `tests/rls/sala-anotar.rls.test.ts`, `e2e/sala-anotar.spec.ts`; cambió `mesas-board.tsx` (botón «Anotar pedido»).

Demo en staging: `/m/la-bestia/centro` (Afiche) y `/m/aurelia/centro` (Minimal), sin Dueño asignado ([ficha](cambios/demo-en-staging.md)). `demo` quedó vacía y de baja: borrarla desde `/admin` desde el 2026-11-23.

## Bloqueos y límites

- **Claves de Supabase de staging**: legacy desactivadas; Fly usa la clave secreta `default` (el CLI la enmascara sin `--reveal`). Falta probar con sesión real SuperAdmin, personal y llamados.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal de comentarios y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`, *workers* `0xC0000409`; con muchos archivos E2E a la vez `sala.spec` falla por carga. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Decisión abierta del usuario: el dock de la mesa parte sus etiquetas en dos líneas a 390 px (viene de antes).

## Próximo paso

1. Aprobar y commitear «Anotar»; desplegar a staging y probar con un local Pro con Dueño (los demos no tienen).
2. **Ítem [M] «Operar el pedido desde la Sala»**: cambiar estados, modificar y cancelar líneas, cerrar y anular (las funciones ya existen). Ahí conviene repensar el orden de la pantalla (hoy el pedido va arriba y la carta debajo).
3. Después, la ficha de cierre (C): precuenta «no válida como factura», retención de 2 años y su purga. Pendiente urgente: **rotar la `service_role` legacy de staging**.
