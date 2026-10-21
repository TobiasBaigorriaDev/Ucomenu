# Cambio: Cuentas globales de Auth, falso 401 de la sala y respaldo de logos
Estado: **para verificar** — implementado y probado en local; aprobado por Codex (2 rondas); falta la aprobación humana
Nivel: C (autorización: quién puede tomar o borrar una cuenta; exposición: un local no debe alcanzar la cuenta de otro ni la de plataforma; eliminación irreversible: borrado de cuentas de Auth y archivos de clientes sin respaldo)

Cuatro correcciones surgidas de una revisión externa, confirmadas contra el código antes de tocarlas. Decisión duradera: [ADR 0032](../../docs/decisiones/0032-reserva-de-cuentas-globales.md).

## 1. SuperAdmin frente a la gestión de personal
**Confirmado.** `resetMemberPassword` solo rechazaba Dueños y cuentas con membresía en otro local; `removeMember` borraba la cuenta de Auth si no quedaban membresías. Un SuperAdmin con membresía de un solo local (Dueño bajado a Staff) quedaba al alcance: contraseña cambiada, o cuenta borrada y —por `platform_admins ON DELETE CASCADE`— su rol de plataforma perdido. Bloquear solo `admin_add_owner` no cubre cuentas que ya tienen membresía.

**Decisión.** La comprobación vive en la base (`personnel_begin_reset`, `personnel_remove_member`): una cuenta de `platform_admins` no se restablece (se responde `shared_account`, sin revelar quién es de la plataforma) y su baja le quita el local pero **conserva la cuenta**. El listado la marca no editable. No se cambió la FK a `RESTRICT` (ver ADR).

## 2. Carreras entre membresías y operaciones globales de Auth
**Confirmado.** Entre el `SELECT` de «¿tiene otra membresía?» y `updateUserById` / `deleteUser` (HTTP, fuera de la transacción) `admin_add_owner` podía sumar la cuenta a otro local: se tomaba una cuenta ya compartida, o se borraba la cuenta y la membresía nueva desaparecía en cascada con una auditoría «added» falsa.

**Decisión.** Reserva por cuenta bajo advisory lock (ADR 0032): la comprobación definitiva y la reserva son una transacción; el trigger de `INSERT` / `UPDATE OF user_id` en `memberships` y `admin_add_owner` (también el ascenso) se niegan con `account_busy` mientras dure. Se libera al terminar la llamada a Auth, también si falla; vence sola a los 2 minutos.

## 3. Auth temporalmente caído → falso 401 en la sala
**Confirmado.** `getCurrentUser` devolvía `null` ante **cualquier** error de `getUser()` y la ruta `/sala/{slug}/estado` respondía 401 (la pantalla pide ingresar de nuevo y deja de reintentar). El `proxy` hacía lo mismo con `getClaims()`.

**Decisión.** `src/lib/auth/errors.ts` separa «sesión inválida» (falta de sesión, JWT rechazado, 4xx de la API salvo 408/429) de lo recuperable (red, 5xx/gateway —que el SDK devuelve como `AuthRetryableFetchError`—, respuesta que no es JSON, 408/429, excepciones ajenas). `lookupCurrentUser` devuelve `user | anonymous | unavailable`; la ruta y el `proxy` responden **503** (`no-store`) ante `unavailable` y 401 solo ante `anonymous`. `getCurrentUser` conserva su contrato para las páginas (Auth caído = al login, como antes).

## 4. `organization-logos` en el respaldo
**Confirmado.** `tools/respaldar.mjs` solo copiaba `product-images`; los logos (archivos de clientes, bucket creado por `identidad_del_local`) no estaban en el respaldo ni en la guía.

**Decisión.** `BUCKETS = [product-images, organization-logos]`. Cada archivo se guarda en `storage/<bucket>/<objeto>` (dos buckets pueden repetir rutas) y el manifiesto —versión 2— declara `buckets` y, por archivo, `bucket` y `objeto`. `verificarRespaldo` exige ambos buckets, rutas coherentes y sin escapes, y sigue aceptando manifiestos de versión 1. Un bucket que no se puede listar hace fallar el respaldo (no queda incompleto en silencio); uno vacío es válido. `objetosPorBucket(manifiesto)` indica qué objeto va a qué bucket al restaurar; la guía (`docs/operacion.md`) lo explica y el ensayo mensual comprueba también un logo.

## Aceptación
- [x] Un Dueño no cambia la contraseña de un SuperAdmin, tampoco después de bajarlo a Staff (regresión: cambio de rol + restablecimiento).
- [x] La baja de un SuperAdmin del personal le quita el local, conserva la cuenta, el rol de plataforma y su acceso (regresión).
- [x] Una cuenta sumada a otro local entre la comprobación y Auth no se toma ni se borra; el SuperAdmin recibe `account_busy`; intercalaciones deterministas en ambos sentidos y con transacciones reales retenidas.
- [x] Los flujos legítimos siguen: restablecer y dar de baja una cuenta exclusiva; sumar la cuenta después de la operación.
- [x] Un error recuperable de `getUser()`/`getClaims()` devuelve 503 y mantiene los reintentos (cadena real SDK → guard → ruta y SDK → `proxy`); un rechazo explícito sigue siendo 401.
- [x] El respaldo incluye `organization-logos`, distingue los buckets en archivos, manifiesto y restauración; probado con datos sintéticos (nada se respaldó con datos reales).

## (C) Invariantes
1. Ninguna cuenta de `platform_admins` cambia de contraseña ni se borra por una acción de un local.
2. Una cuenta con membresía en más de un local nunca se toma ni se borra desde uno de ellos, ni siquiera si la segunda membresía llega durante la operación.
3. La comprobación y la reserva son atómicas; ninguna membresía entra a una cuenta reservada (cualquier camino, `service_role` incluido).
4. Una reserva nunca bloquea una cuenta para siempre (vence) ni la libera otra operación (token).
5. Auth caído nunca se informa como «sesión inválida»; una sesión inválida nunca se informa como Auth caído.
6. Todo archivo de cliente en Storage está en el respaldo, con el bucket al que pertenece.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| El servidor muere entre la reserva y Auth | La reserva vence a los 2 minutos; la operación no se hizo (se repite) o se hizo y la reserva sobra (inofensivo). |
| Auth falla en `updateUserById` / `deleteUser` | Se libera la reserva y se informa; en la baja la membresía ya se quitó (la cuenta queda sin local, sin acceso a nada) y se registra en el log. |
| Dos operaciones globales sobre la misma cuenta | La segunda recibe `busy` / `account_busy`: reintentar en segundos. |
| Llamada a Auth colgada > 2 min | La reserva vence y la ventana se reabre (límite aceptado, ADR 0032). |
| Auth caído al leer la sala | 503; la pantalla muestra «Sin conexión» y reintenta con la sesión intacta. |
| Bucket inexistente o no listable en el respaldo | El respaldo falla con el nombre del bucket; nunca queda incompleto en silencio. |
| Migración mal aplicada | Rollback en la cabecera de `20261104100000_proteger_cuentas_globales.sql`. |

## Alcance / fuera de alcance
Incluye: migración, `personnel.ts`, mapeo `account_busy` en SuperAdmin, `errors.ts`/`session.ts`/ruta/`proxy`, `respaldar.mjs`, pruebas, `docs/operacion.md`, ADR 0032. No incluye: timeout propio de las llamadas a Auth; coordinar el alta de SuperAdmin por SQL del operador; la UX de las páginas (login) ante Auth caído; restauración automatizada.

## Migración
`supabase/migrations/20261104100000_proteger_cuentas_globales.sql`: tabla privada, dos funciones privadas, trigger, tres funciones de API (solo `service_role`) y `admin_add_owner` reemplazada (una línea). Aditiva, sin datos. **Staging no la tiene** (requiere aprobación).

## Evidencia
Local, 2026-10-21, sobre el árbol sin commitear de esta ficha (el commit probado se anota en «Revisión»), con `pnpm db:reset` y la migración nueva:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` **707/707** (nuevas: 18 en `sala-estado-auth.test.ts` —cadena real SDK → guard → ruta y SDK → `proxy` con red caída, 500/502/503/429, 401 `bad_jwt`, 403 `session_not_found` y sin cookie—, 1 en `sala-estado-route.test.ts`, `respaldar.test.ts` ampliado a 20 pruebas con datos sintéticos).
- `pnpm test:rls` completo **874** pruebas en 38 archivos: en la corrida completa 860 verdes, 1 fallo y 1 archivo caído (13 pruebas sin correr); ambos ajenos al cambio (un worker caído con `0xC0000409` en `borrado-de-organizaciones` y un `ALTER` sobre `audit_log` en `owner-lectura` que chocó con otro archivo en paralelo) y **pasaron al repetir esos dos archivos** (35/35). Nuevas: 19 en `cuentas-globales.rls.test.ts` (SuperAdmin, 5 intercalaciones deterministas con ganchos, 3 con transacciones reales retenidas, reserva, permisos) y 1 en `acl.rls.test.ts` (+ la matriz de funciones).
- E2E (`--workers=1`, contra el build): `acceso`, `sala`, `panel-llamados-aviso`, `dueno-existente` y `llamados` **76/76**.
- **Mutaciones** (SQL directo, restauradas): sin el chequeo de SuperAdmin en restablecer (3 pruebas fallan), en la baja (2), sin la llamada en `admin_add_owner` (1: el ascenso; el `INSERT` lo cubre el trigger), sin el trigger (3), baja que ignora otras membresías (2), restablecer sin el lock (2, con espera de 24 s). Módulo: `isTransientAuthError` forzado a `false` hace fallar 11 de 18 pruebas de la cadena.
- **No probado / límites:** staging (la migración no está allí); la llamada a Auth colgada más de 2 minutos; el respaldo contra el Supabase local o remoto con datos reales (por pedido: solo datos sintéticos); un teléfono real con Auth caído.

## Revisión y aprobación
- **Codex, ronda 1 (commit `f648e81`, nivel C, esfuerzo high): APROBAR CON CAMBIOS.** Revisión estática. Un hallazgo *importante*, **confirmado**: el trigger de la reserva cubría solo `INSERT`; `service_role` puede reasignar `memberships.user_id` con `UPDATE` y sumar una membresía a una cuenta reservada (contraseña tomada o membresía borrada en cascada). Corrección: el trigger pasó a `BEFORE INSERT OR UPDATE OF user_id` (un `UPDATE` que no cambia `user_id`, p. ej. solo el rol, no se frena). Regresión nueva en `cuentas-globales.rls.test.ts` que **falla con el trigger solo de `INSERT`** (comprobado) y pasa con el actual; RLS de `cuentas-globales`, `acl`, `personnel`, `dueno-existente` y `tenancy` **128/128** tras la corrección.
- **Codex, ronda 2 de verificación (commit `7454a01`): APROBAR, sin hallazgos nuevos**; el hallazgo de la ronda 1 queda corregido y sin regresiones visibles (revisión estática).
- Pendiente: la **aprobación humana** (no está dada) antes de subir a `origin`, aplicar la migración en staging o desplegar.
