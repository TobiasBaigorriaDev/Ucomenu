# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**En curso, sin commit (sobre `8b7cca7`, rama `main`):** [estilo de carta «Afiche»](cambios/estilo-afiche.md) (M), un cuarto estilo con Big Shoulders, bandas de color y platos numerados. Implementado y verificado en local; la evidencia está en la ficha. Falta:
1. Que el usuario lo apruebe (local de prueba sintético: `/m/birra-demo/centro` y `/t/afc0ffee000000000000000000000004`, solo en la base local).
2. El commit.
3. Aplicar `20261125100000_estilo_afiche.sql` en staging, con aprobación.

Decisión abierta del usuario: el dock de la mesa parte sus etiquetas en dos líneas a 390 px en todos los estilos (viene de antes).

Antes: S1 y S2 de «Salón y crecimiento» hechas y en staging (Fly versión 40, migración `20261124100000`): [promociones](cambios/promociones-y-precio-efectivo.md), [panel](cambios/panel-de-promociones.md), [carta con precio promocional](cambios/carta-con-precio-promocional.md) (sin LCP medido) e [historial](cambios/historial-de-promociones.md).

## Bloqueos y límites

- **Claves de Supabase de staging**: legacy desactivadas; Fly usa la clave secreta `default` (sin `--reveal` el CLI la devuelve enmascarada). Falta probar con sesión real SuperAdmin, personal y llamados.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal de comentarios y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`, *workers* `0xC0000409`. E2E con `--workers=3`. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Despliegue desde Windows: `flyctl deploy -c fly.staging.toml` con las cuatro `NEXT_PUBLIC_*` como `--build-arg` (ver `docs/produccion.md`).
- Next.js 16.4.3 con excepción `minimumReleaseAgeExclude` en `pnpm-workspace.yaml`.

## Próximo paso

1. Aprobación y commit del afiche; luego staging.
2. Probar en staging con sesión real SuperAdmin, personal, llamados, promociones y zona horaria.
3. Cambiar la clave secreta de `.env.local` si usaba la legacy y **rotar la `service_role` legacy de staging** (urgente).
4. S3 «Pedidos del mozo» (C), sobre `effective_prices`.
