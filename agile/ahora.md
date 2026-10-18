# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` está en `origin` (`428d05b`) y no hay ramas de trabajo abiertas ni cambios sin confirmar. Staging está al día: migraciones hasta `20261024100000` aplicadas y la app de `main` desplegada en Fly (`7fb1ca8`; lo posterior es solo documentación y herramientas). La base local quedó en seed limpio.

Hecho hoy, todo integrado y probado por el usuario en staging (con teléfono):
- [Desactivar y reactivar sucursales](cambios/desactivar-sucursales.md) (C, Codex 2 rondas).
- [Sumar una cuenta existente como Dueño](cambios/dueno-existente.md) (C, Codex 2 rondas; riesgo residual aceptado y documentado).
- [Login y sala en vivo con el lenguaje del panel](cambios/ui-login-y-sala.md) (M).
- [Carta de demostración en staging](cambios/demo-en-staging.md): `/m/demo/centro`, 26 platos con 24 fotos. La organización `demo` no tiene cuentas: para editarla hay que sumarla a un Dueño desde SuperAdmin («Sumar un Dueño»).

## Bloqueos y riesgos

- `flyctl.exe` lo bloquea Smart App Control (no está firmado): se despliega con la imagen `flyio/flyctl` en Docker y la sesión en el volumen `ucomenu-fly-config` (procedimiento en `docs/produccion.md`; no pide login de nuevo).
- Producción sigue bloqueada: dominio, proyecto de Supabase de producción, revisión legal y aprobación del usuario ([ficha](cambios/salida-a-produccion.md), ADR 0015). La demo en producción sería una decisión aparte.
- El alta de organización exige un Dueño inicial con cuenta nueva; para un dueño con dos locales se crea con un email provisorio y se suma la cuenta existente.
- `carta.spec.ts` «tope de platos activos» cae a veces bajo carga paralela y pasa solo. Si `pnpm build` da EPERM sobre `.next`, borrar `.next`.

## Próximo paso

Elegir una tarea desbloqueada del [tablero](tablero.md). Recomendada: **[C] lectura de pagos y de la auditoría por el Dueño** (útil antes de salir a producción; es exposición de datos, así que pasa por Codex y aprobación humana). Alternativas: retención y purga de `price_history` (prerrequisito de borrar organizaciones; necesita una política de retención del usuario) o pulir la ficha de detalle del plato como bento. Si otro agente trabaja en el mismo repositorio, usar un worktree propio.
