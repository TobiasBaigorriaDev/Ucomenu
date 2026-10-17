# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` contiene el rediseño de la carta pública. Integrado también (a `main` local, sin subir a `origin`) está el rediseño del panel del Dueño y de SuperAdmin con el mismo lenguaje (riel lateral en escritorio y chips en celular, celdas con filete, Gloock + Schibsted; el Dueño con la paleta de su local, SuperAdmin con la de UcoNext). Revisado de forma independiente y por Codex (aprobado); evidencia y decisiones en la [ficha](cambios/ui-panel-dueno-y-superadmin.md). `DESIGN.md` y `.impeccable/design.json` describen ahora los dos mundos (carta y panel).

La demo se llena con `pnpm db:demo` (`--sin-fotos` y `--sin-logo` para el peor caso). Antes de correr RLS o E2E hay que volver al seed limpio: `pnpm db:reset` o `pnpm db:demo --quitar` (la base quedó en seed limpio al cerrar esta sesión). Detener `pnpm dev` antes de `pnpm build` o de los E2E y reiniciarlo después: compilar con el servidor vivo le deja el CSS desactualizado.

## Bloqueos y riesgos

- El login, la sala en vivo y `/cuenta` (solo su contenido) conservan el estilo anterior: tras entrar, el cambio de lenguaje es visible. El login no se tocó por alcance.
- No se corrió `rendimiento-carta` ni RLS en esta ronda (sin cambios de esquema ni de la carta pública).
- Dos corridas completas de E2E seguidas se cayeron en una verificación anterior por el servidor de prueba; correr por tandas si vuelve a pasar.
- Pendiente de la carta: la ficha de detalle no se rehízo como bento. Las migraciones de identidad, carta, disponibilidad y slugs existen solo en local; ensayo remoto requiere autorización. Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015.

## Próximo paso

1. Que el usuario mire el panel y SuperAdmin en el navegador (`pnpm dev`) y decidir cuándo subir `main` a `origin`.
2. Opcional: rehacer el login y la sala en vivo con el mismo lenguaje, y la ficha de detalle del plato como bento.
3. Si no, retomar «Desactivar sucursales» ([ficha](cambios/desactivar-sucursales.md)), con sus cinco decisiones ya aprobadas.
4. Con autorización: aplicar migraciones a staging, desplegar `main` y probar con sesión SuperAdmin, sucursales y la carta en un teléfono real.
