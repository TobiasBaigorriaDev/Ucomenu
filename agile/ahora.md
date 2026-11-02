# Ahora (handoff)

Actualizado: 2026-11-02 · agente saliente: Claude Code.

## Punto de retomada

Rama `feat/registro-autoservicio` (3 commits sobre `main`, solo local, sin subir): **registro autoservicio de dueños**, nivel C. Revisión de Codex aprobada en la ronda 3. Alcance, evidencia y límites en [la ficha](cambios/registro-autoservicio.md); decisiones en [ADR 0053](../docs/decisiones/0053-registro-autoservicio.md).

Migración `20261218100000` solo en local: todavía se puede editar. La siguiente libre es `20261219100000`. `pnpm db:start` ahora levanta Mailpit: `registro.spec.ts` lo necesita.

## Bloqueos y próximo paso

1. **El usuario decide:** ¿quien supera los límites de Básico puede elegirlo al pagar? Hoy no (ver «Decisión pendiente» en la ficha). Además falta su aprobación para integrar a `main`.
2. **El usuario crea:** cuenta de Resend con DNS en Cloudflare, cliente OAuth de Google y widget de Turnstile. Pasos en `docs/produccion.md`, sección 1c.
3. **Staging, con aprobación:** aplicar la migración, configurar Auth y desplegar. Antes de abrir el registro, crear un mozo y entrar con su contraseña: el trigger de `auth.users` depende de cómo crea cuentas Auth. Google, Turnstile y Resend reales están sin probar.
4. **Producción** sigue bloqueada por lo de siempre (`docs/produccion.md`): datos legales, abogado (ahora también con Resend, Google y Turnstile), contador, Supabase y Fly de producción y cuenta de cobro de Mercado Pago.

Pendiente del cobro en staging: probar «Ya pagué, verificar», un pago rechazado y un reembolso, ahora también con la elección de plan. Staging sigue en Fly v95.

Fallas previas ajenas a este cambio: `alta-guiada.spec.ts:183` y `:196` y `resumen-panel.spec.ts:57` fallan igual en `main`. Intermitentes: `portada.spec.ts:92`, `videos-mux.spec.ts:145`, `revision-claude.test.ts` (tiempos agotados) y caídas de worker `0xC0000409`.

Entorno: Docker Desktop se apaga solo y hay que reiniciarlo; OneDrive provoca bloqueos de E2E (usar `--workers=4`). Preservar los archivos locales sin seguimiento (`video/`, `.codegraph/`, capturas, skills, `skills-lock.json`, `.claude/launch.json`).
