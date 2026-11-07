# Cambio: Cuentas creadas por un Dueño no son prueba de un buzón
Estado: **implementado y probado en local; sin commit remoto ni despliegue** (producción y staging necesitan aprobación aparte).
Nivel: **C** — toca identidad y autorización (cuentas, contraseñas), la prueba gratis (dinero) y el registro público. Origen: auditoría de seguridad run-2 (2026-11-07), hallazgos `auth/owner-provisioned-confirmed-account-for-unproven-email` (media) y `registro/trial-gate-trusts-owner-minted-confirmed-accounts` (baja), y la pista `auth/owner-minted-account-keeps-known-password-after-google-link`.

## Problema
`createMember` (src/lib/personnel.ts) crea al personal con `email_confirm: true` y una contraseña que elige el Dueño, para cualquier correo y sin tope. Con el registro libre (ADR 0053) esto permite: (1) abrir locales de prueba con esas cuentas, porque `self_register_organization` toma `email_confirmed_at` como prueba del buzón; (2) que el Dueño conserve una contraseña válida sobre la cuenta de una persona que después entra con enlace por correo o Google; (3) saber si un correo ya tiene cuenta.

## Decisiones (a confirmar por el usuario antes de desplegar)
1. **Marca.** Las cuentas que crea un Dueño llevan `app_metadata.mailbox = "unverified"` (solo la clave de servicio escribe ese campo).
2. **Abrir un local.** `self_register_organization` rechaza `mailbox = unverified` con `email_not_confirmed`. Las cuentas anteriores, sin marca, siguen igual (no se rompe a nadie que ya trabaja).
3. **Probar el correo.** Cuando la persona entra por un enlace de correo (`/auth/confirmar`) o por Google (`/auth/callback`) y la cuenta está sin verificar, el servidor reemplaza la contraseña por una al azar, pone `mailbox = verified`. Cambiar la contraseña desde el servidor hace que Auth cierre TODAS las sesiones de la cuenta (descubierto en la prueba de punta a punta: también la de la persona); por eso el servidor abre una sesión nueva para ella con un enlace propio (`generateLink` + `verifyOtp`). Por enlace, la persona va a elegir su contraseña (`/cuenta/nueva-contrasena`). Si el reemplazo falla, se cierra la sesión (falla cerrado). Entrar con la contraseña del Dueño **no** prueba el correo y no cambia nada.
4. **Después de probar el correo**, el Dueño ya no puede restablecer esa contraseña (`resetMemberPassword` devuelve `mailbox_verified`); la persona usa «Olvidé mi contraseña». Las cuentas sin marca conservan el restablecimiento de siempre.
5. **Tope de personas** por local: 60 (`MAX_MEMBERS_PER_ORG`). Es una barrera de tamaño, no un límite de frecuencia: dar de baja borra la cuenta, así que alta y baja en ciclo no se acotan, y contar y crear no es atómico. Lo que cierra el abuso de las pruebas gratis es la marca (decisión 2).
6. **Orden de la prueba del correo.** Contraseña al azar (Auth cierra todas las sesiones, incluida la del Dueño), luego la marca y por último la sesión nueva de la persona. Si falla entre pasos, la cuenta sigue sin verificar y el próximo enlace reintenta; si falla la sesión nueva, la persona pide otro enlace. Una cuenta común no pide ni la clave de servicio.

## Qué no cubre (queda como riesgo conocido)
- **Cuentas que un Dueño ya creó antes de este cambio** no llevan marca: pueden abrir locales de prueba y conservan la contraseña del Dueño al entrar por enlace. Se pueden marcar de una vez con una consulta aparte (aprobación de producción) o dejarlas.
- **`src/lib/admin/organizations.ts:251`** (el SuperAdmin crea a un Dueño con contraseña) tiene el mismo patrón y no lleva marca; solo lo alcanza un SuperAdmin.
- Los tokens de acceso del Dueño siguen valiendo hasta una hora tras cerrar sus sesiones.
- El mensaje «Abrí el enlace que te mandamos» al rechazar una cuenta sin verificar no se ajusta del todo: a esas cuentas no se les mandó ningún enlace.
- Saber si un correo ya tiene cuenta (`email_unavailable`) sigue siendo posible, con el tope de 60 solo para altas exitosas; un límite por frecuencia pide una tabla de contadores y se deja para otro cambio. Severidad baja.
- Una ventana de milisegundos entre que la persona prueba su correo y el Dueño restablece la contraseña: `personnel_begin_reset` no toma en cuenta la marca (se decidió no tocar esa función de las reservas de cuentas, ADR 0032).
- Una cuenta puede entrar con Google sin que Auth la una a la existente: depende de la configuración de Auth (pista por validar en staging).

## Archivos
`supabase/migrations/20261220100000_cuentas_creadas_por_duenos.sql`, `src/lib/registro/buzon.ts`, `src/lib/registro/buzon-sesion.ts`, `src/lib/registro/actions.ts`, `src/app/auth/callback/route.ts`, `src/lib/personnel.ts`.

## Aceptación
- [x] Una cuenta creada por `createMember` lleva `mailbox = unverified`.
- [x] `self_register_organization` la rechaza; con `verified` o sin marca la acepta (RLS: `registro-autoservicio.rls.test.ts`).
- [x] Al probar el correo se reemplaza la contraseña, se marca `verified` y falla cerrado (unitaria: `tests/unit/buzon.test.ts`).
- [x] De punta a punta contra el build y el buzón local: entrar con la contraseña del Dueño no cambia nada; entrar por el enlace del correo reemplaza esa contraseña, deja a la persona elegir la suya y la del Dueño deja de servir (`e2e/cuentas-creadas-por-duenos.spec.ts`).
- [x] El Dueño restablece la contraseña mientras `unverified` o sin marca, y no cuando está `verified` (`personnel.rls.test.ts`).
- [x] El Dueño no pasa de 60 personas por local (`personnel.rls.test.ts`).
- [ ] Prueba manual en staging con dos buzones: crear una cuenta como Dueño, entrar con el enlace del correo y comprobar que la contraseña del Dueño ya no sirve; repetir con Google (también valida la pista de enlace de identidades).
- [ ] Revisión independiente (nivel C) y aprobación del usuario antes de aplicar la migración y desplegar.

## Evidencia
Typecheck y lint sin errores. Unitarias: 1473 casos, los 11 fallos de `respaldo-cifrado` son el problema conocido de `tar` en Git Bash y pasan (12/12) en PowerShell. RLS (base local): `personnel`, `cuentas-globales`, `cuentas-sin-local`, `acl` y `registro-autoservicio`, 133 casos verdes. Commit: pendiente.

## Recuperación
Revertir el código y volver a crear `self_register_organization` con la definición de `20261218100000_registro_autoservicio.sql`. Las cuentas ya marcadas quedan con una marca inocua. Si una persona quedó con la contraseña al azar, entra por «Olvidé mi contraseña».
