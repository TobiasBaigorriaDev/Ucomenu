# Ahora (handoff)

Actualizado: 2026-10-24 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**S3 «Pedidos del mozo»:** los tres primeros ítems son solo base de datos, aprobados por Codex y por el usuario y **ya en staging**: [esquema](cambios/pedidos-esquema-y-alta-de-items.md), [opciones](cambios/pedidos-variantes-adicionales-observaciones.md) y [estados y registro](cambios/pedidos-estados-y-registro.md) (migración `20261128100000`). Siguiente migración libre: `20261129100000`.

**Cuarto ítem hecho y desplegado en staging, Fly versión 46** (M): [vista «Mesas» y total en «Pide la cuenta»](cambios/sala-mesas-y-total.md): `/sala/{slug}/mesas` con su sondeo, y el total del pedido en la tarjeta del llamado. Sin migración; aprobado por el usuario. Falta probarlo con sesión real.

Demo en staging: `/m/la-bestia/centro` (Afiche) y `/m/aurelia/centro` (Minimal), sin Dueño asignado ([ficha](cambios/demo-en-staging.md)). `demo` quedó vacía y de baja: borrarla desde `/admin` desde el 2026-11-23.

## Bloqueos y límites

- **Claves de Supabase de staging**: legacy desactivadas; Fly usa la clave secreta `default` (el CLI la enmascara sin `--reveal`). Falta probar con sesión real SuperAdmin, personal y llamados.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal de comentarios y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`, *workers* `0xC0000409`. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Decisión abierta del usuario: el dock de la mesa parte sus etiquetas en dos líneas a 390 px (viene de antes).

## Próximo paso

1. Probar «Mesas» en staging con sesión real (hoy no hay forma de anotar un pedido desde la app: ver el punto 2).
2. **Hueco del tablero:** ítem [M] «Anotar y operar pedidos desde la Sala» (plato con variantes y observación, estados, cancelar, cerrar y anular). Hoy ninguna pantalla crea pedidos; solo existen las funciones de base.
3. Después, la ficha de cierre (C): precuenta «no válida como factura», retención de 2 años y su purga. Pendiente urgente: **rotar la `service_role` legacy de staging**.
