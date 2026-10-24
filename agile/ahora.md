# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

**Último cambio:** [estilo de carta «Afiche»](cambios/estilo-afiche.md) (M): cuarto estilo con Big Shoulders, bandas de color y platos numerados. Aprobado por el usuario, commit `a3bde86` en `origin/main`, migración `20261125100000` en staging y app en **Fly versión 44**. Falta probarlo con sesión real eligiendo Afiche en staging. El local sintético `birra-demo` existe solo en la base local.

**Staging (2026-10-24):** `demo` y `prueba-videos` se quitaron; hay dos locales de demostración nuevos, `/m/la-bestia/centro` (Afiche) y `/m/aurelia/centro` (Minimal), cargados con `tools/sembrar-demo-staging.mjs` (cambios sin commit). `demo` quedó vacía y de baja: borrarla de `/admin` desde el 2026-11-23. Los chequeos HTTP de despliegue ya no usan `/m/demo/centro`.

Decisión abierta del usuario: el dock de la mesa parte sus etiquetas en dos líneas a 390 px en todos los estilos (viene de antes).

Antes: S1 y S2 de «Salón y crecimiento» hechas y en staging (Fly versión 40, migración `20261124100000`): [promociones](cambios/promociones-y-precio-efectivo.md), [panel](cambios/panel-de-promociones.md), [carta con precio promocional](cambios/carta-con-precio-promocional.md) (sin LCP medido) e [historial](cambios/historial-de-promociones.md).

## Bloqueos y límites

- **Claves de Supabase de staging**: legacy desactivadas; Fly usa la clave secreta `default` (sin `--reveal` el CLI la devuelve enmascarada). Falta probar con sesión real SuperAdmin, personal y llamados.
- Clientes recurrentes (S4) espera a un abogado. Dominio, revisión legal de comentarios y purgas programadas bloquean producción.
- `pnpm test`: falla ajena `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`, *workers* `0xC0000409`. E2E con `--workers=3`. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Despliegue desde Windows: `flyctl deploy -c fly.staging.toml` con las cuatro `NEXT_PUBLIC_*` como `--build-arg` (ver `docs/produccion.md`).
- Next.js 16.4.3 con excepción `minimumReleaseAgeExclude` en `pnpm-workspace.yaml`.

## Próximo paso

1. Probar en staging con sesión real: Afiche en Apariencia, SuperAdmin, personal, llamados, promociones y zona horaria.
2. Cambiar la clave secreta de `.env.local` si usaba la legacy y **rotar la `service_role` legacy de staging** (urgente).
3. S3 «Pedidos del mozo» (C), sobre `effective_prices`.
