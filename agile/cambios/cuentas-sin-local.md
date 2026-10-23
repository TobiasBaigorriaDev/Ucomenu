# Cambio: Cuentas de Auth sin ningún local
Estado: **implementado y verificado en local; pendiente de revisión independiente (nivel C) y de subir a staging.**
Nivel: **C** — borra cuentas de Auth (eliminación irreversible) y toca la reserva de cuentas que protege contra la carrera con las membresías ([ADR 0032](../../docs/decisiones/0032-reserva-de-cuentas-globales.md)). Origen: [borrado de organizaciones](borrado-de-organizaciones.md) (fuera de alcance: «borrar las cuentas que queden sin local»).

## Objetivo
Al borrar una organización sus membresías se van en cascada y las cuentas de su personal quedan en Auth sin ningún local. Decisión del usuario (2026-10-23): **conservarlas, listarlas en SuperAdmin y permitir borrar una a mano con confirmación**. Nunca se borra una cuenta sola.

## Decisiones (particulares)
1. Pantalla `/admin/cuentas` (enlace «Cuentas sin local» en `/admin`): email, fecha de alta y último ingreso, hasta 100 cuentas, las más nuevas primero. Cada una tiene su formulario: **email escrito**, **motivo** y casilla.
2. Una cuenta es «sin local» si **no tiene membresías, no es de un SuperAdmin, tiene más de 1 hora y no tiene una reserva vigente**. La hora de gracia evita que el alta de una organización (que crea la cuenta antes que la membresía) deje borrar una cuenta a mitad de camino.
3. Tres funciones de base, solo `service_role`, que vuelven a exigir SuperAdmin: `admin_list_orphan_accounts`, `admin_begin_orphan_delete` (comprueba todo bajo el lock por cuenta y toma la **reserva** de 2 minutos de ADR 0032) y `admin_record_account_deleted`. Entre la reserva y la llamada a Auth nadie suma una membresía (`account_busy`, `55006`); si la sumaron antes, la cuenta ya no está sin local y no se borra.
4. El borrado en Auth es HTTP, fuera de la transacción: reserva → `auth.admin.deleteUser` → se libera la reserva → se audita. **La constancia (`account.deleted`) se escribe después y solo si la cuenta ya no existe, una vez por cuenta.** Guarda el id y el motivo, **nunca el email** (convención de `audit_log`). Residuo aceptado: si el servidor muere entre borrar y auditar, la cuenta está borrada sin constancia (queda el aviso en el registro del servidor).
5. Sin ADR nuevo: es una extensión de la reserva de ADR 0032 (se agrega una enmienda ahí).

## Invariantes
- Solo un SuperAdmin lista y borra; `anon` y `authenticated` no ejecutan las funciones (`42501`).
- No se borra una cuenta con membresía, de SuperAdmin, de menos de 1 hora, con reserva vigente, con el email o el motivo vacíos o con un email distinto.
- Un borrado fallido o ambiguo no deja reserva colgada (se libera; vence sola a los 2 minutos).

## Aceptación
- [x] La lista deja afuera cuentas nuevas, con local, de SuperAdmin y reservadas; quien no es SuperAdmin no la ve.
- [x] Con el email correcto (sin distinguir mayúsculas) y el motivo, la cuenta se borra de Auth y queda en los movimientos sin el email.
- [x] Email distinto, motivo vacío, id inexistente, cuenta con local, de SuperAdmin, reciente o reservada: no se borra nada y el mensaje lo explica.
- [x] La membresía que entra durante el borrado se rechaza; la que entra antes impide el borrado.
- [x] Pantalla a 390 px sin desborde; quien no es SuperAdmin recibe 404.
- [ ] Revisión independiente (C) y despliegue en staging (migración + Fly).

## Evidencia
Sobre el diff sin commitear de `main` (2026-10-23):
- `pnpm typecheck`, `pnpm lint` limpios · `pnpm db:reset` con `20261117100000_cuentas_sin_local.sql` · `pnpm db:types`.
- RLS: `cuentas-sin-local` 11/11; con `cuentas-globales`, `borrado-de-organizaciones`, `personnel`, `acl`, `admin`, `dueno-existente` y `addons-y-baja` **8 archivos, 218/218**.
- E2E contra el build: `superadmin-cuentas-sin-local` 3/3 y los demás `superadmin*` 41/41.
- `pnpm test` 902/903; la única falla es `textos.test.ts` («Menufeed», ajena a este cambio).
- Mutaciones (aplicadas a la base local y restauradas): sin el chequeo de membresías en `admin_begin_orphan_delete` fallan 2 pruebas; sin la reserva falla la de «mientras se borra, nadie le suma una membresía».
