# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Tercera tanda (UX, nivel M) implementada y probada en local; falta la aprobación del usuario.** Rama `main`. [Ficha](cambios/formularios-cuenta-y-mensajes.md). Sin migración ni cambios de base.

1. El alta de personal queda inactiva (campos y botón) sin permiso de escritura, con el aviso arriba; el servidor sigue rechazándola.
2. `/cuenta` de un SuperAdmin usa el marco de `/admin` y vuelve a `/admin` (con segundo enlace a su panel si también trabaja en un local); Dueño y Staff, igual que antes.
3. El resultado de guardar traducciones se ve junto al botón fijo, una sola vez.
4. Errores y «no encontrado» por zona: general en la raíz, propios en `panel`, `sala` y `admin` (dentro del marco cuando se puede) y el mensaje de la carta solo en `/m` y `/t`.

Tanda 2 ([listas, orden e imágenes atómicos](cambios/orden-e-imagenes-atomicos.md), ADR 0033, migración `20261105100000`) y tanda 1 ([cuentas globales](cambios/proteger-cuentas-globales.md), ADR 0032, migración `20261104100000`): aprobadas por Codex, **sin aprobación humana**. Staging no tiene esas migraciones. También pendiente de aprobación: [borrado de mesas](cambios/borrado-de-mesas.md). Fase 2 = feed de videos con **Mux Video** ([ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal).
- Siguen con paginación por offset: carta pública, idiomas, sucursales, opciones de un plato y disponibilidad (ver la ficha de la tanda 2).
- No hay `global-error.tsx`: un error del layout raíz usa la pantalla por defecto de Next.
- Flaky conocido: en RLS completo, `owner-lectura` choca a veces con otro archivo que toca `audit_log`, y un worker puede caer con `0xC0000409`. Se repiten una vez.
- E2E con `--workers=1`; RLS y E2E no a la vez.

## Próximo paso

1. El usuario aprueba las tres tandas; recién entonces subir a `origin`, aplicar las migraciones pendientes en staging y desplegar.
2. Probar a mano en staging: alta de personal con una cuenta vencida, `/cuenta` con el SuperAdmin, y el guardado de traducciones en una carta larga.
