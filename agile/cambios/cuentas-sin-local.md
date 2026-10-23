# Cambio: Cuentas de Auth sin ningún local
Estado: **implementado y verificado en local; ronda 1 de Codex con tres hallazgos corregidos (`1e27efb` + corrección); falta su verificación y subir a staging.**
Nivel: **C** — borra cuentas de Auth (eliminación irreversible) y toca la reserva de cuentas que protege contra la carrera con las membresías ([ADR 0032](../../docs/decisiones/0032-reserva-de-cuentas-globales.md)). Origen: [borrado de organizaciones](borrado-de-organizaciones.md) (fuera de alcance: «borrar las cuentas que queden sin local»).

## Objetivo
Al borrar una organización sus membresías se van en cascada y las cuentas de su personal quedan en Auth sin ningún local. Decisión del usuario (2026-10-23): **conservarlas, listarlas en SuperAdmin y permitir borrar una a mano con confirmación**. Nunca se borra una cuenta sola.

## Decisiones (particulares)
1. Pantalla `/admin/cuentas` (enlace «Cuentas sin local» en `/admin`): email, fecha de alta y último ingreso, hasta 100 cuentas, las más nuevas primero. Cada una tiene su formulario: **email escrito**, **motivo** y casilla.
2. Una cuenta es «sin local» si **no tiene membresías, no es de un SuperAdmin, tiene más de 1 hora y no tiene una reserva vigente**. La hora de gracia evita que el alta de una organización (que crea la cuenta antes que la membresía) deje borrar una cuenta a mitad de camino.
3. Tres funciones de base, solo `service_role`, que vuelven a exigir SuperAdmin: `admin_list_orphan_accounts`, `admin_begin_orphan_delete` (comprueba todo bajo el lock por cuenta y toma la **reserva** de 2 minutos de ADR 0032) y `admin_record_account_deleted`. Entre la reserva y la llamada a Auth nadie suma una membresía (`account_busy`, `55006`); si la sumaron antes, la cuenta ya no está sin local y no se borra.
4. El borrado en Auth es HTTP, fuera de la transacción: reserva → `auth.admin.deleteUser` → se libera la reserva → se audita. **Si Auth devuelve un error (también de red, con la respuesta perdida) no se supone nada: se le pregunta directamente si la cuenta sigue** (`getUserById`): ya no existe → se cuenta como borrada y se audita; sigue → «no se cambió nada»; no se puede saber → «no pudimos confirmar». Un fallo de la reserva (antes de tocar Auth) nunca es «incierto». **La constancia (`account.deleted`) se escribe después y solo si la cuenta ya no existe, una vez por cuenta.** Se serializa con un lock por cuenta, así que dos pedidos a la vez dejan un solo movimiento. Guarda el id y el motivo, **nunca el email** (convención de `audit_log`). Residuos aceptados: si el servidor muere entre borrar y auditar, o si Auth no responde ni al borrar ni al preguntar si la cuenta sigue, la cuenta puede quedar borrada sin constancia (queda el aviso en el registro del servidor). En ese caso **repetir es seguro**: una cuenta intacta se borra y se audita; una ya borrada responde «no existe». El mensaje de «no pudimos confirmar» lo dice así; no usa la lista como prueba (la lista excluye también cuentas con local, reservadas o más allá de las 100).
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
- [x] Borrado con respuesta de Auth perdida: cuenta ya borrada → se audita; cuenta intacta → fallo claro; sin poder averiguarlo → «no pudimos confirmar».
- [x] Dos constancias simultáneas dejan un solo movimiento.
- [ ] Verificación de Codex (ronda 2) y despliegue en staging (migración + Fly).

## Evidencia
Sobre el diff sin commitear de `main` (2026-10-23):
- `pnpm typecheck`, `pnpm lint` limpios · `pnpm db:reset` con `20261117100000_cuentas_sin_local.sql` · `pnpm db:types`.
- RLS: `cuentas-sin-local` 11/11; con `cuentas-globales`, `borrado-de-organizaciones`, `personnel`, `acl`, `admin`, `dueno-existente` y `addons-y-baja` **8 archivos, 218/218**.
- E2E contra el build: `superadmin-cuentas-sin-local` 3/3 y los demás `superadmin*` 41/41.
- `pnpm test` 902/903; la única falla es `textos.test.ts` («Menufeed», ajena a este cambio).
- Mutaciones (aplicadas a la base local y restauradas): sin el chequeo de membresías en `admin_begin_orphan_delete` fallan 2 pruebas; sin la reserva falla la de «mientras se borra, nadie le suma una membresía»; sin el lock de la constancia falla la de pedidos simultáneos.

## Revisión independiente
- **Ronda 2** (verificación sobre `11ae0e3`, informe `output/revisiones/2026-10-23T07-23-40-commit-HEAD.md`): hallazgos 1 y 3 corregidos; el 2 quedaba parcial (el mensaje de recuperación usaba la lista como prueba de borrado) y se corrigió con el mensaje de «repetir es seguro» y su prueba.
- **Ronda 1** (Codex, informe `output/revisiones/2026-10-23T06-55-02-commit-HEAD.md`, sobre `1e27efb`): aprobar con cambios, tres hallazgos importantes, todos **corregidos**: (1) un error de red de Auth se informaba como «no se cambió nada» aunque la cuenta pudiera estar borrada; (2) el mensaje de recuperación daba por borrada una cuenta que solo estaba oculta por la reserva; (3) la constancia podía duplicarse con pedidos simultáneos. RLS `cuentas-sin-local` pasó de 11 a 16 pruebas.
