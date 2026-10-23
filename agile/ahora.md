# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Se exploró y **el usuario aprobó** (D1–D14, 2026-10-23) el diseño del incremento **«Salón y crecimiento»**: sucursal adicional para Pro, invitación a reseñar en Google, promociones programadas (Happy Hour), pedidos que **anota el mozo** (el comensal no pide) y clientes recurrentes. Solo documentación, sin código ni migraciones:

- Reglas en `docs/producto.md` (módulos 7 a 10 y sucursal adicional) y diseño en `docs/arquitectura.md`.
- Motivos en los ADR [0039](../docs/decisiones/0039-sucursal-adicional-y-vistas-previas.md), [0040](../docs/decisiones/0040-promociones-programadas.md), [0041](../docs/decisiones/0041-pedidos-del-mozo.md) y [0042](../docs/decisiones/0042-clientes-recurrentes.md); enmienda en el ADR 0003 (el socio será `customers`).
- Fases S1–S4 en `agile/tablero.md`; seleccionada la **sucursal adicional** ([ficha](cambios/sucursal-adicional.md), nivel C).

El incremento anterior quedó en `origin/main` (`98a0c23`) y en staging (Fly versión 32).

## Bloqueos y límites

- Clientes recurrentes (S4) espera la revisión de un abogado; los pedidos (S3) esperan la función de precio efectivo de S2.
- La ficha de la sucursal adicional fija detalles nuevos que conviene confirmar al empezar: fórmula de desactivaciones, Premium finaliza el add-on solo y Básico exige finalizarlo antes.
- Siguen pendientes: el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed», commit `07facba`). Fallas intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls`.

## Próximo paso

1. Implementar la sucursal adicional con `agile-iterar`: migración (catálogo genérico, `org_limit`, `admin_set_extra_branches`, `admin_change_plan`), SuperAdmin, Suscripción y Sucursales; RLS de `limits`/`billing` con concurrencia; revisión de Codex.
2. Seguir con el enlace y la invitación a reseñar (M) y las vistas previas por organización (C).
3. Pendientes del incremento anterior: probar en un teléfono real (llamado, likes, comentarios), `/admin/cuentas` y rotar la `service_role` legacy de staging.
