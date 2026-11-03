# Cambio: Registro autoservicio de dueños
Estado: **integrado a `main` y en staging, aprobado por el usuario (2026-11-02)**. Producción sigue bloqueada (`docs/produccion.md`).
Nivel: **C** — abre el registro público (autorización), cambia planes y cobro (dinero), trata datos personales de terceros nuevos y purga cuentas (eliminación irreversible). Motivos en [ADR 0053](../../docs/decisiones/0053-registro-autoservicio.md).

## Objetivo
Una persona entra a la portada, se registra con su correo o con Google, crea su local y empieza 14 días de Pro sin intervención de nadie. Al terminar, elige Básico o Pro y paga con Mercado Pago.

## Decisiones aprobadas por el usuario (2026-11-01)
- Ingreso con email y contraseña, confirmado por correo, y con Google.
- Correo por Resend, conectado como SMTP de Supabase.
- El Dueño elige Básico o Pro al pagar; el plan cambia cuando se acredita el pago.
- El local se activa al confirmar el email, con captcha Turnstile, una prueba por cuenta y aviso en SuperAdmin.

Decisiones técnicas y alternativas: ADR 0053.

## Flujo
1. `/registro`: email + Turnstile, o «Continuar con Google». La respuesta es la misma exista o no la cuenta.
2. Correo con enlace → `/auth/confirmar` → botón «Confirmar» → sesión.
3. `/panel` sin locales → `/crear-local`: nombre del local, dirección, contraseña (si entró por enlace) y aceptación de términos.
4. `self_register_organization` crea todo → `/panel/{slug}` con la guía de primeros pasos.
5. Suscripción: elige plan y ciclo, paga, y el pago registra el plan.

Recupero: `/recuperar` → correo → `/auth/confirmar` → `/cuenta/nueva-contrasena`.

## Tareas
- [x] A. ADR 0053 y esta ficha.
- [x] B. Base: `trial_claims`, `organizations.origin`, `self_register_organization`, `purge_unconfirmed_accounts`, cuentas sin confirmar fuera de `/admin/cuentas`; `pnpm db:types`.
- [x] C. Auth local: `config.toml` (registro, confirmación, plantillas, Google apagado), `/registro`, `/auth/confirmar`, `/auth/callback`, `/recuperar`, `/cuenta/nueva-contrasena`, enlaces en login y selección de destino sin local.
- [x] D. `/crear-local`: formulario y acción; contraseña obligatoria si se entró por enlace, y cierre de las demás sesiones.
- [x] E. Turnstile verificado en el servidor (falla cerrado si está configurado a medias).
- [x] F. Cobro: plan y ciclo elegibles, plan de origen en la intención y cambio de plan al registrar el pago.
- [x] G. SuperAdmin: etiqueta «Alta propia» en la lista y la ficha.
- [x] H. Portada, FAQ y `/login`: botones a `/registro`; WhatsApp queda para consultas.
- [x] I. `/terminos`, `/privacidad` (Resend, Google, Turnstile, hash del email), `.env.example`, `prod:check`, `docs/producto.md`, `docs/arquitectura.md`, `docs/operacion.md`, `docs/produccion.md`, enmienda al ADR 0007.
- [x] J. Pruebas: RLS, unitarias y E2E con el buzón local (Mailpit).
- [x] K. Revisión independiente (Codex, 3 rondas). Aprobado por el usuario el 2026-11-02, con la integración a `main`.
- [ ] L. Staging y producción, con aprobación aparte (ver «Lo que necesita al usuario»).

## Invariantes
- Solo un email confirmado crea un local; lo comprueba la base contra `auth.users`, no el formulario.
- Una cuenta sin local puede leer y escribir lo mismo que `anon`.
- Un email reclama una sola prueba, también después de borrar la cuenta o el local.
- El plan, el importe y la vigencia nunca salen del navegador. Solo se elige entre planes con precio de lista, y lo valida la base.
- El plan cambia únicamente en la misma transacción que registra el pago.
- Con un período pago vigente no se cambia de plan ni de ciclo: solo se renueva.
- Las respuestas de `/registro` y `/recuperar` no revelan si una cuenta existe.
- La purga nunca borra cuentas confirmadas, con membresía, de SuperAdmin o con reserva vigente.

## Fallos y recuperación
| Fallo | Comportamiento |
| --- | --- |
| Correo no llega o Resend agotado | Mensaje genérico; se puede reintentar pasado el límite por email. No se crea ningún local. |
| Enlace vencido o ya usado | `/auth/confirmar` explica y ofrece pedir otro. |
| El antivirus abre el enlace | No gasta el token: `verifyOtp` corre recién con el botón. |
| Turnstile caído | `/registro` y `/recuperar` fallan cerrado con un aviso; el login no depende de Turnstile. |
| Falla la creación del local | Transacción: no queda nada a medias y se puede reintentar. |
| Falla la contraseña después del local, o al revés | La contraseña se guarda antes de crear el local; si el local falla, la cuenta sigue vacía y se reintenta. |
| Dirección ocupada | `slug_taken`; se pide otra sin perder lo escrito. |
| Pago de un plan que el local ya no admite | A revisar, sin extender (ADR 0052). |
| El SuperAdmin cambia el plan con un link abierto | `plan_changed`, a revisar, sin extender. |

**Marcha atrás:** apagar el registro en Auth y quitar los botones cierra la entrada; los locales creados siguen funcionando. Cada migración trae su reversión.

## Aceptación
- [x] Registro por correo de punta a punta en local (E2E con Mailpit): termina en el panel, con Pro y 14 días.
- [x] Un email ajeno precargado con contraseña por la API deja de entrar en el momento de confirmar, antes de crear el local.
- [x] Recupero de contraseña de punta a punta.
- [x] Una cuenta sin local no ve ni escribe nada que `anon` no pueda.
- [x] Segunda prueba con el mismo email, o con su variante `+etiqueta`, rechazada.
- [x] Elegir Básico al pagar deja el plan Básico solo al registrarse el pago; con más sucursales de las permitidas no se ofrece.
- [x] Con un período pago vigente no se puede cambiar de plan.
- [x] Pantallas a 390 px sin desborde.
- [x] Google y Turnstile reales probados en staging (prueba del usuario; ver «Staging»).

## Lo que necesita al usuario
1. Cuenta de Resend y sus registros DNS en Cloudflare para `ucomenu.com`.
2. Cliente OAuth de Google Cloud, con la URL de retorno de cada proyecto de Supabase.
3. Widget de Turnstile en Cloudflare (clave de sitio y secreta).
4. Aprobación para cambiar Auth y desplegar en staging, y más tarde en producción.
5. Abogado: revisión de los textos legales con los terceros nuevos.

## Decisión del usuario sobre los límites (2026-11-02)
Quien supera los límites de Básico no puede elegirlo al pagar: primero reduce sucursales, mesas o platos. `docs/producto.md` la registra como excepción a «lo que supera el límite se conserva».

## Evidencia
Sobre el diff de la rama, antes del commit de revisión (2026-11-02):
- `pnpm typecheck`, `pnpm lint` y `pnpm build` limpios; `pnpm db:reset` con `20261218100000` y `pnpm db:types`.
- `pnpm test`: 1448 pruebas, con un fallo propio del cambio (cantidad esperada en `verificar-produccion.test.ts`) ya corregido; el archivo se volvió a correr solo.
- `pnpm test:rls`: 1639/1639, incluidas las 21 de `registro-autoservicio`. La prueba de «cuenta sin local» recorre todas las tablas de `public` y todas las funciones que `authenticated` puede ejecutar.
- E2E completo contra el build (`--workers=4`): 589 pasaron, 1 omitida, 5 fallaron.
  - `registro.spec.ts` y `acceso.spec.ts` en verde: registro de punta a punta, contraseña ajena anulada, antivirus que abre el enlace, enlace usado, recupero y Dueño existente.
  - **Fallos previos, ajenos al cambio:** `alta-guiada.spec.ts:183` (2 casos), `:196` y `resumen-panel.spec.ts:57`. Se repitieron y fallan igual en un `main` limpio (`f072eca`), contra la misma base. Los de la guía cuentan un enlace del tutorial; el de Resumen no se investigó más allá de esa comparación.
  - **Intermitentes:** `videos-mux.spec.ts:145` falló en la corrida completa y pasó al repetirla; `portada.spec.ts:92` falló dos veces en una corrida aislada y pasó en la completa. No se tocó ese código.
- Capturas a 390 px revisadas: registro, correo, crear local y elegir plan.

**Sin probar:** Google, Turnstile real y Resend real (necesitan cuentas; solo hay pruebas unitarias de la verificación de Turnstile). La pantalla «elegir plan» no tiene prueba E2E de pago contra el doble de Mercado Pago; el cambio de plan al pagar se prueba en RLS.

**Tras la ronda 1 de revisión (2026-11-02):** `pnpm test:rls` 1643/1643; E2E de registro, acceso, cobro, cuentas sin local y portada: 68 pasaron y 1 falló (`portada.spec.ts:92`, el intermitente de arriba). `pnpm typecheck` y `pnpm lint` limpios; `pnpm test`: 2 tiempos agotados en `revision-claude.test.ts` con la máquina cargada, que no toca este cambio.

Mutaciones contra la base local, restaurada después con `pnpm db:reset`: sin el efecto del trigger falla «borra en esa misma escritura»; sin los candados de límites falla «un plato que se está creando»; sin el candado global falla «con altas simultáneas». Las tres pruebas retienen una transacción real en otra conexión, o confirman directo en la base.

**Tras la ronda 2 de revisión (2026-11-02):** `pnpm test:rls` 1645/1645; `pnpm test` 1449/1449; `pnpm typecheck` y `pnpm lint` limpios. E2E de registro, acceso, cobro y cuentas sin local: 54 pasaron y 1 falló (`registro.spec.ts:142`, el recupero sobre una cuenta precargada). No se pudo reproducir: pasó sola y en 3 repeticiones bajo carga, y el registro de Auth muestra `invalid_credentials` para la contraseña ajena; la causa de ese fallo aislado queda sin determinar. En `registro` + `acceso` × 3: 125 pasaron y 1 caída de worker (`0xC0000409`) ajena al cambio. Mutaciones: con la condición anterior (`xmin`) falla «también la borra si la transacción escribió la fila antes»; sin la marca de creación falla «conserva su contraseña».

**A probar en staging:** el trigger depende de que Auth cree las cuentas del servidor en una sola transacción (insertar y confirmar). Si la versión de Auth en la nube usara otra transacción, esas cuentas perderían la contraseña y entrarían por `/recuperar`: crear un mozo y entrar con su contraseña antes de abrir el registro. Hay que correrlo también después de cada actualización de Auth.

## Staging (2026-11-02, autorizado por el usuario)
Migración `20261218100000` aplicada. App desplegada desde `git archive` de la rama, sin integrar a `main`: Fly **v100**, imagen `registro-cd80cb4-git`. Marcha atrás de la app: `--image registry.fly.io/ucomenu-staging:cobro-3b9c6d2-git` (v95). Los secretos `TURNSTILE_SECRET_KE` y `GOOGLE_LOGIN_ENABLE` tenían el nombre incompleto y se corrigieron.

**Comprobado en staging:**
- Una cuenta del servidor nace confirmada y entra con su contraseña; una precargada deja de valer al confirmar (`invalid_credentials`), contra el Auth de la nube.
- Con enlaces generados por la API de administración (sin correo): confirmar → `/crear-local` → panel, con origen `self_service`, Pro y 14 días; carta pública 200.
- Suscripción ofrece Básico y Pro por mes y por año con los precios de lista; elegir Básico lleva a Mercado Pago y el plan sigue en Pro antes de pagar.
- Recupero con enlace generado: la contraseña vieja deja de entrar y la nueva entra.
- `/registro` sin token de Turnstile: el servidor lo rechaza.
- El botón de Google lleva a la pantalla de Google, sin error de configuración.
- Los datos de prueba se borraron. Queda el hash en `trial_claims` y la auditoría de esa alta.

**Prueba del usuario con cuentas reales (2026-11-02):** informó «todo ok». En la base quedaron dos altas propias con Pro hasta el 17/11 y sucursal `principal`: `marcelo-polleria` (identidad `email`) y `tobi-prueba` (identidad `google`). Con eso quedan vistos el correo real, sus plantillas y *Site URL*, y Google de una cuenta nueva. Turnstile real se deduce de la primera: `/registro` rechaza sin token, pero no hay un registro propio de cada verificación.

**Segunda prueba del usuario (2026-11-02):** informó que el recupero con correo real y el pago eligiendo plan funcionan. Quedó registrado un pago de `marcelo-polleria` por Pro mensual, ARS 29.000, con vigencia hasta el 17/12. Ese pago no cambió de plan: el cambio de plan al pagar está probado en la base y en E2E contra el doble de Mercado Pago, no con un pago real.

**Después de esa prueba:** logo de Google en el botón, aviso propio para el Dueño de un local dado de baja y selector de planes con Pro destacado.

**Observaciones:** la pantalla de Google muestra `oasixhsdyigimwvcxtkx.supabase.co`, no la marca; se corrige con un dominio propio de Auth (de pago en Supabase). No hay registro DMARC en `ucomenu.com`. Una prueba mandó un enlace a una casilla de `fldubai.com` que no llegó a crearse; la cuenta se borró.

## Cambio de plan y reembolso con Mercado Pago de prueba (2026-11-03)
- **Cambio de plan real:** `tobi-prueba` pagó Básico mensual (ARS 14.900, pago `186415679165`) y pasó de Pro a Básico en la misma operación, con `subscription.plan_changed` y `payment.registered` en la auditoría.
- **Reembolso real (total, hecho por el usuario desde la actividad del vendedor de prueba):** el aviso llegó en 1 s y se procesó como `reversal_flagged`. Mercado Pago mandó tres avisos y quedó una sola fila «a revisar» (`payment_reversed`). La vigencia y el plan no cambiaron, como manda el ADR 0052.
- **Dato:** con usuarios de prueba, `live_mode` da `true`: el token es `APP_USR-`. Para saber si un pago es de prueba hay que mirar la etiqueta `test_user` de la cuenta y el correo del comprador.
- **Anulación por el SuperAdmin (usuario, 2026-11-03):** el pago quedó anulado con auditoría y la vigencia volvió al fin de la prueba (17/11).
- **Revisión resuelta** por el usuario: no quedan pagos a revisar en staging.
- **Pago rechazado:** el usuario informó que hizo todo, pero en los registros de la app no aparece ningún pago rechazado; se considera sin comprobar.
- **Decisión del usuario (2026-11-03):** anular un pago devuelve la fecha, no el plan. Quien eligió Básico, pagó y pidió la devolución queda en Básico y elige de nuevo al vencer; el SuperAdmin puede devolverle Pro a mano.

## Verificación de la integración (2026-11-02)
Antes de integrar, sobre los ajustes de pantalla: `pnpm typecheck` y `pnpm lint` limpios; `pnpm test` 1449/1449; `pnpm test:rls` 1645/1645 en la repetición. E2E completo: 592 pasaron, 1 omitida y 4 fallaron.
- `acceso.spec.ts:85`: propio del cambio («Básico» aparece más de una vez en Suscripción). Corregido y repetido en verde.
- `alta-guiada.spec.ts:183` (2 casos) y `:196`: los mismos fallos previos, que también ocurren en `main` limpio. Sin tocar.
- `owner-lectura`: la falla intermitente ya conocida. Causa: la prueba cambiaba la restricción de auditoría por una lista a mano a la que le faltaban 13 acciones. Ahora parte de la lista real.
- Prueba nueva: en prueba elige Básico anual, el plan cambia recién con el aviso de pago (contra el doble de Mercado Pago).

## Revisión y aprobación
- **Ronda 1 (Codex, sobre `4a36227`): RECHAZAR**, informe `output/revisiones/2026-11-02T17-41-36-commit-HEAD.md`. Tres hallazgos, los tres reales:
  1. Bloqueante: la contraseña precargada valía entre confirmar y crear el local, y su JWT sobrevivía al cierre de sesión. Corregido en la raíz con un trigger que la borra en la misma escritura que confirma. La primera versión también borraba la de las cuentas del servidor; lo detectaron las pruebas y se acotó a cuentas anteriores a la transacción.
  2. Carrera al acreditar Básico contra altas de platos y mesas. Corregido tomando los mismos candados que los triggers de límites.
  3. El tope de altas se podía superar con pedidos simultáneos. Corregido serializando las altas propias.
- **Ronda 2 (Codex, sobre `711cc17`): RECHAZAR**, informe `output/revisiones/2026-11-02T19-08-10-commit-HEAD.md`. Límites y tope, corregidos. Bloqueante, parcial: al recuperar, Auth escribe la fila antes de confirmarla en la misma transacción, y `old.xmin` la confundía con una cuenta recién creada. Corregido con un trigger de INSERT que marca qué cuenta nació en la transacción; sin la marca, la contraseña se borra.
- **Ronda 3 (Codex, sobre `d94d06b`): APROBAR**, sin hallazgos ni regresiones, informe `output/revisiones/2026-11-02T19-42-11-commit-HEAD.md`. Codex revisó el código sin ejecutar pruebas.
- **Aprobación del usuario (2026-11-02):** integrar a `main` y desplegar en staging; límites de Básico como están. Los ajustes de pantalla posteriores a la ronda 3 no pasaron por Codex: no tocan permisos, base ni importes.
