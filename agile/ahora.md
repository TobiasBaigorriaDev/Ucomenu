# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Del incremento «Salón y crecimiento», S1 está hecha y en staging (Fly versión 37). De S2 (Promociones) hay dos piezas aprobadas por Codex y por el usuario (2026-10-23), con **las migraciones aplicadas en staging y los commits en `origin/main` (hasta `09a7dbd`), pero la app sin desplegar**:

- **Zona horaria por sucursal (M)**, [ficha](cambios/zona-horaria-por-sucursal.md), migración `20261122100000`.
- **Promociones y precio efectivo (C)**, [ficha](cambios/promociones-y-precio-efectivo.md), migración `20261123100000`. Tablas, historial de solo-agregado, `promotions` en Pro y Premium, `effective_prices` y su réplica `src/lib/promociones/precio.ts`. Nada la llama todavía.

`fly deploy -c fly.staging.toml` fue denegado por el clasificador de permisos de Claude Code. No hace falta con urgencia: la app de staging no usa lo nuevo.

## Bloqueos y límites

- Clientes recurrentes (S4) espera la revisión de un abogado. Siguen pendientes el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed», commit `07facba`). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls` y los *workers* con `0xC0000409`. Los E2E fallan por carga con los *workers* por defecto: usar `--workers=3`. `tools/escenarios-locales.mjs` es ajeno y sin seguir: no se tocó.
- Next.js está en **16.4.3** con una excepción `minimumReleaseAgeExclude` en `pnpm-workspace.yaml`: se puede quitar cuando cumpla la antigüedad mínima.

## Próximo paso

1. Desplegar la app en staging (`fly deploy -c fly.staging.toml`, a mano o con permiso explícito) cuando haya una pantalla que use lo nuevo.
2. Siguientes de S2, ya desbloqueados: panel de promociones del Dueño (M), carta con precio promocional en vivo (M) y pantalla del historial (S). Los pedidos (S3) usan `effective_prices`.
3. Probar en staging con sesión real: vistas previas, sucursal adicional, enlace de reseñas y zona horaria.
4. Pendientes anteriores: teléfono real (llamado, likes, comentarios), `/admin/cuentas` y **rotar la `service_role` legacy de staging** (urgente: se imprimió por error en el registro de una sesión del 2026-10-23).
