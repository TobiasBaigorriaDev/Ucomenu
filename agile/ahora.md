# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

La **Fase 3 (fidelización, Wallet, cercanía) quedó fuera de este incremento** por decisión del usuario; va en otro. Se cerró casi todo «Mejoras y decisiones pendientes del MVP»; **subido a `origin/main` (`98a0c23`) y desplegado en staging** (migraciones `20261116100000`, `20261117100000` y `20261118100000`; Fly versión 32). El usuario aprobó comentarios y likes (2026-10-23):

- **Escrituras públicas solo desde el servidor** (nivel C): `create_waiter_call`, `set_video_like` y `submit_video_comment` las ejecuta solo `service_role` (migración `20261116100000`, [ADR 0038](../docs/decisiones/0038-escrituras-publicas-solo-servidor.md), [ficha](cambios/escrituras-publicas-solo-servidor.md)). Aprobado por Codex.
- **Cuentas de Auth sin local** (nivel C): `/admin/cuentas`, borrado a mano con email, motivo y reserva (migración `20261117100000`, [ficha](cambios/cuentas-sin-local.md)). Aprobado por Codex en 3 rondas.
- **Guía de primeros pasos** descartable por cuenta y resumen por sucursal (nivel M, migración `20261118100000`, [ficha](cambios/guia-descartable.md)).
- **Variantes y adicionales**: las seis decisiones conservadoras quedaron confirmadas, sin código.

## Bloqueos y límites

- La app depende de `SUPABASE_SERVICE_ROLE_KEY` en la ruta de llamar, dar like y comentar (staging la tiene).
- Sigue pendiente: el **dominio** (pospuesto por el usuario) y, para habilitar comentarios en producción, la revisión de un abogado y programar la purga.
- Sin probar en teléfono real: comentarios y likes (Firefox, Safari de escritorio y Android, en «Para verificar»).
- `pnpm test` tiene una falla ajena a estos cambios: `textos.test.ts` («Menufeed» igual en es y en, commit `07facba`).
- E2E contra el build; `next build` se detiene una vez por un aviso de Next. Fallas ajenas intermitentes: `sala.spec:323`, `owner-lectura.rls`.

## Próximo paso

1. Verificación completa hecha sobre `e3831dd` (2026-10-23): RLS 51 archivos, 1139/1139; build; E2E 422/424 (las dos fallas, `sala.spec:323` y `videos-mux.spec:145`, pasan solas al repetir).
2. Probar en un teléfono real sobre staging (llamado, likes, comentarios) y `/admin/cuentas` con una sesión de SuperAdmin.
3. Rotar la `service_role` legacy de staging (salió impresa en una sesión); `fly secrets set`.
4. Elegir del tablero: dominio, Salida a producción, o abrir el incremento de fidelización.
