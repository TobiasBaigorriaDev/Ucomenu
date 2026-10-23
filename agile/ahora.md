# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Del incremento «Salón y crecimiento», S1 está hecha y en staging (Fly versión 37): sucursal adicional, enlace de reseñas, invitación a reseñar y vistas previas de funciones. De S2 (Promociones) hay dos piezas hechas **solo en local, sin subir a staging ni a `origin`**:

- **Zona horaria por sucursal (M)**, [ficha](cambios/zona-horaria-por-sucursal.md), migración `20261122100000`, commit `4130912`. Lista cerrada de 22 zonas, la edita el Dueño. Facturación y mora siguen en hora de Argentina.
- **Promociones y precio efectivo (C)**, [ficha](cambios/promociones-y-precio-efectivo.md), migración `20261123100000`, commits `12e3bb7`, `c70da2b` y `74562af`. Tablas, historial de solo-agregado, `promotions` en Pro y Premium, `effective_prices` y su réplica `src/lib/promociones/precio.ts`. **Codex aprobó en la ronda 3**; falta tu aprobación humana antes de subir la migración, porque toca planes y la función de borrado de organizaciones. Nada la llama todavía.

## Bloqueos y límites

- Clientes recurrentes (S4) espera la revisión de un abogado. Siguen pendientes el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed», commit `07facba`). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls` y los *workers* con `0xC0000409`. Los E2E fallan por carga con los *workers* por defecto: usar `--workers=3`. `tools/escenarios-locales.mjs` es ajeno y sin seguir: no se tocó.
- Next.js está en **16.4.3** con una excepción `minimumReleaseAgeExclude` en `pnpm-workspace.yaml`: se puede quitar cuando cumpla la antigüedad mínima.

## Próximo paso

1. Aprobar (o no) la migración de promociones; si se aprueba, subirla a staging junto con la de zona horaria.
2. Siguientes de S2, ya desbloqueados: panel de promociones del Dueño (M), carta con precio promocional en vivo (M) y pantalla del historial (S). Los pedidos (S3) usan `effective_prices`.
3. Probar en staging con sesión real: vistas previas, sucursal adicional, enlace de reseñas y zona horaria.
4. Pendientes anteriores: teléfono real (llamado, likes, comentarios), `/admin/cuentas` y **rotar la `service_role` legacy de staging** (urgente: se imprimió por error en el registro de una sesión del 2026-10-23).
