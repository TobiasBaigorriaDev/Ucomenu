# Ahora (handoff)

Actualizado: 2026-11-03 · agente saliente: Claude Code.

## Punto de retomada

En `main`. El **registro autoservicio de dueños** (nivel C) está integrado, subido a `origin/main` y en staging: correo o Google, local creado solo con Pro por 14 días, recupero por correo y plan elegido al pagar. Revisión de Codex aprobada en la ronda 3 y aprobación del usuario del 2026-11-02. Alcance, evidencia y límites en [la ficha](cambios/registro-autoservicio.md); decisiones en [ADR 0053](../docs/decisiones/0053-registro-autoservicio.md).

Migración `20261218100000` aplicada en local y staging; la siguiente libre es `20261219100000`. Marcha atrás de la app: `--image registry.fly.io/ucomenu-staging:registro-cd80cb4-git` (v100), o `cobro-3b9c6d2-git` (v95) para quitar el registro. `pnpm db:start` ahora levanta Mailpit: `registro.spec.ts` lo necesita.

## Bloqueos y próximo paso

1. **Falta ver con Mercado Pago de prueba:** un pago que cambie de plan (de Pro a Básico). El pago real registrado fue Pro sobre Pro; el cambio de plan está probado en la base y contra el doble. También siguen sin probar un pago rechazado y un reembolso.
2. **Sugerido antes de producción:** registro DMARC en `ucomenu.com` y decidir el dominio propio de Auth, porque la pantalla de Google muestra la dirección de Supabase.
3. **Producción** sigue bloqueada (`docs/produccion.md`, secciones 1c y 3c): datos legales, abogado (ahora también con Resend, Google y Turnstile), contador, Supabase y Fly de producción y cuenta de cobro. Repetir la configuración de Auth de la sección 1c y programar la purga de la 4.f. Tras cada actualización de Auth, comprobar que una cuenta creada por el servidor entra con su contraseña.

Fallas previas ajenas: `alta-guiada.spec.ts:183` y `:196` (cuentan un enlace del tutorial) y `resumen-panel.spec.ts:57` (sin investigar; falló y pasó según la corrida). Intermitentes: `portada.spec.ts:92`, `videos-mux.spec.ts:145`, `revision-claude.test.ts` (tiempos agotados) y caídas de worker `0xC0000409`.

Entorno: Docker Desktop se apaga solo y hay que reiniciarlo; OneDrive provoca bloqueos de E2E (usar `--workers=4`). Preservar los archivos locales sin seguimiento (`video/`, `.codegraph/`, capturas, skills, `skills-lock.json`, `.claude/launch.json`).
