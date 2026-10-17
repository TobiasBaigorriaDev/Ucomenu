# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Rama `feat/desactivar-sucursales` (desde `main`, **sin integrar**): el Dueño desactiva y reactiva sucursales desde `/panel/{slug}/sucursales`. La inactiva no cuenta para el tope del plan, su carta, su alias y los QR de sus mesas dicen «no disponible», no admite llamados nuevos y sale de Mesas, Llamados, Sala y Resumen; reactivar respeta el tope. Migración `20261023100000_desactivar_sucursales.sql`. Implementación, invariantes, evidencia (RLS 628/628, E2E con dos fallos ajenos que pasan al repetir) y las dos rondas de Codex están en la [ficha](cambios/desactivar-sucursales.md).

Nivel C: Codex revisó dos rondas (un hallazgo real de carrera en `create_waiter_call`, corregido y con prueba que falla sin la corrección; otro sobre la robustez de esa prueba, también corregido). **Falta la aprobación humana** de permisos y tope, que el veredicto de Codex no reemplaza.

La base local quedó en seed limpio. `carta.spec.ts` «tope de platos activos» cae bajo carga paralela y pasa solo (ajeno a este cambio).

## Bloqueos y riesgos

- La migración existe solo en local; aplicarla en staging/producción requiere autorización. Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015.
- No se probó en un teléfono real. Login, sala en vivo y `/cuenta` conservan el estilo anterior; la ficha de detalle del plato no se rehízo como bento.

## Próximo paso

1. Que el usuario apruebe (o corrija) el cambio C y decida si integra la rama a `main`.
2. Con autorización: aplicar migraciones a staging, desplegar `main` y probar con sesión SuperAdmin, sucursales y la carta en un teléfono real.
3. Opcional: rehacer login y sala con el lenguaje del panel; SuperAdmin podría reactivar/desactivar en el futuro (hoy solo el Dueño).
