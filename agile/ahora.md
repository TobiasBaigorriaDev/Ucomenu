# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Segunda tanda de cuatro correcciones (C) implementada y probada en local; falta la revisión de Codex y la aprobación humana.** Rama `main`. [Ficha](cambios/orden-e-imagenes-atomicos.md) · [ADR 0033](../docs/decisiones/0033-orden-e-imagenes-atomicos.md) (propuesta).

1. Las lecturas «de todo» (carta, mesas, configuración del llamado, sala, guía) van por páginas con orden estable: ya no se cortan en 1000 filas.
2. Reordenar es una sola llamada (`reorder_siblings`): todo o nada, y si otro movimiento se coló se relee y se reintenta.
3. Reemplazar o quitar foto y logo devuelve la referencia saliente (`replace_product_image`, `replace_organization_logo`): se borra solo esa; un fallo de limpieza se avisa y no rompe la vigente.
4. `PhotoForm` revoca sus URL `blob:`.

**Migración nueva** `20261105100000_orden_e_imagenes_atomicos.sql` (tres funciones `SECURITY INVOKER`). Staging **no** la tiene (requiere aprobación). Gotcha: PostgREST reintenta sin fin el SQLSTATE `40001`; se usó `55000`.

Primera tanda ([cuentas globales](cambios/proteger-cuentas-globales.md), ADR 0032): aprobada por Codex, sin aprobación humana. También pendientes de aprobación: [borrado de mesas](cambios/borrado-de-mesas.md); el de categorías y platos ya está en staging. Fase 2 = feed de videos con **Mux Video** ([ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal).
- Un archivo puede quedar sin borrar si Storage falla (queda en el registro con su ruta); `LogoForm` ya revocaba sus URL.
- Flaky conocido: en RLS completo, `owner-lectura` choca a veces con otro archivo que toca `audit_log`, y un worker puede caer con `0xC0000409`. Se repiten una vez.
- E2E con `--workers=1`; RLS y E2E no a la vez.

## Próximo paso

1. `pnpm revision:codex --commit HEAD --ficha agile/cambios/orden-e-imagenes-atomicos.md --nivel C`; corregir lo confirmado.
2. El usuario aprueba; recién entonces subir a `origin`, aplicar las migraciones pendientes en staging y desplegar.
