# Ahora (handoff)

Actualizado: 2026-11-02 · agente saliente: Claude Code.

## Punto de retomada

Rama `feat/registro-autoservicio`, sin subir ni integrar a `main`: **registro autoservicio de dueños**, nivel C, en staging (Fly v100, imagen `registro-cd80cb4-git`). Revisión de Codex aprobada en la ronda 3. Alcance, evidencia y límites en [la ficha](cambios/registro-autoservicio.md); decisiones en [ADR 0053](../docs/decisiones/0053-registro-autoservicio.md).

Migración `20261218100000` aplicada en local y staging: si cambia el esquema, migración nueva, `20261219100000`. Marcha atrás: `--image registry.fly.io/ucomenu-staging:cobro-3b9c6d2-git` (v95). `pnpm db:start` ahora levanta Mailpit: `registro.spec.ts` lo necesita.

## Bloqueos y próximo paso

1. **El usuario decide:** ¿quien supera los límites de Básico puede elegirlo al pagar? Hoy no (ver «Decisión pendiente» en la ficha). Además falta su aprobación para integrar a `main`.
2. **Falta probar en staging:** el recupero con correo real y pagar eligiendo plan. El registro con correo real y con Google ya los probó el usuario (detalle en la ficha). Propuesto y sin aprobar: corregir el aviso «Tu cuenta no tiene ningún local» para el Dueño de un local dado de baja.
3. **Después, con aprobación:** integrar a `main`. El trigger de `auth.users` ya se comprobó contra el Auth de staging; repetirlo tras cada actualización de Auth.
4. **Producción** sigue bloqueada por lo de siempre (`docs/produccion.md`): datos legales, abogado (ahora también con Resend, Google y Turnstile), contador, Supabase y Fly de producción y cuenta de cobro de Mercado Pago.

Pendiente del cobro en staging: probar «Ya pagué, verificar», un pago rechazado y un reembolso, ahora también con la elección de plan.

Fallas previas ajenas a este cambio: `alta-guiada.spec.ts:183` y `:196` y `resumen-panel.spec.ts:57` fallan igual en `main`. Intermitentes: `portada.spec.ts:92`, `videos-mux.spec.ts:145`, `revision-claude.test.ts` (tiempos agotados) y caídas de worker `0xC0000409`.

Entorno: Docker Desktop se apaga solo y hay que reiniciarlo; OneDrive provoca bloqueos de E2E (usar `--workers=4`). Preservar los archivos locales sin seguimiento (`video/`, `.codegraph/`, capturas, skills, `skills-lock.json`, `.claude/launch.json`).
