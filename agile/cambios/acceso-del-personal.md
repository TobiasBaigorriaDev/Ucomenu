# Cambio: Acceso del personal — login, sesión, `/panel` y `/sala` por rol, alta de personal y aviso de mora
Estado: **para verificar** — implementado y probado en la rama `feat/acceso-del-personal` (sin integrar a `main`); falta la revisión independiente de nivel C
Nivel: C

## Objetivo
Que el Dueño y el personal entren a UcoMenu con su cuenta y vean solo lo que les corresponde: login por email y contraseña, sesión por cookies, `/panel` (carta, mesas, a futuro) y `/sala` (operación en vivo) protegidos **en el servidor** por rol, el Dueño dando de alta, bajando y gestionando a su personal desde el panel, y el aviso de mora visible. Desbloquea «Gestión de carta» y «Panel de sala».

## Decisiones del usuario (2026-10-14)
1. **Login:** email y contraseña. Sin registro público (el alta de organizaciones llega con SuperAdmin / alta guiada).
2. **Alta del personal:** el Dueño crea la cuenta de su equipo (`staff` u otro `owner`) con email y contraseña inicial/temporal, desde el servidor con `service_role` (sin correo). El Dueño también **restablece la contraseña** de su personal; cualquier usuario cambia la **suya** dentro de su sesión. **Invariante:** una organización nunca se queda sin al menos un `owner`, aplicado en la base.
3. **Dueño inicial y usuarios de prueba:** usuarios de ejemplo en el seed (owner y staff por organización, incluida la morosa) y un script local de desarrollo para crear dueños iniciales.
4. **Varias organizaciones:** selector simple de organización activa al entrar, y cambio desde la cabecera; con una sola, entra directo.
5. **Acceso por rol:** owner y staff entran a `/panel` y `/sala`. Dentro de `/panel`, el staff **no ve ni accede** a Suscripción/Plan, Personal ni Apariencia/Configuración (UI + servidor + RLS). `/admin` queda fuera. Se incluye el **aviso de mora** en `/panel` (gracia 1–7, solo lectura 8–15, suspendida 16+).
6. **Recuperar contraseña por correo:** fuera de este ítem (sin SMTP externo).

## Decisiones de diseño (derivadas; revisables)
- **Organización activa en la URL**, no en una cookie: `/panel/{slug}/…` y `/sala/{slug}`. `/panel` y `/sala` resuelven: 0 membresías → mensaje; 1 → redirigen; 2+ → selector. Sin estado oculto, cada pedido revalida la membresía del slug y dos pestañas pueden operar en organizaciones distintas.
- **Identidad por `getUser()` en el servidor** (valida contra Auth, detecta usuarios borrados); **el rol sale de `memberships`** en cada pedido (ADR 0005), nunca del JWT. El `proxy.ts` **refresca** la sesión y, sin sesión, redirige a `/login` conservando la ruta completa pedida; no autoriza (cada página vuelve a comprobar).
- **Sin cliente de Supabase en el navegador**: el login, el cierre y los cambios son *server actions*; las cookies de sesión van `httpOnly`.
- **`service_role` solo en el servidor** (`SUPABASE_SERVICE_ROLE_KEY`, sin `NEXT_PUBLIC_`), y solo en el módulo de personal. Antes de usarla, el servidor comprueba con el **cliente de la persona** (RLS) que es `owner` de la organización del pedido, y que el objetivo pertenece a **esa** organización.
- **No se amplía la superficie de la Data API**: ninguna función `SECURITY DEFINER` nueva en `public`, ningún permiso de escritura nuevo sobre `memberships`.
- **Cuentas de varias organizaciones:** el Dueño **no puede** restablecer la contraseña ni borrar la cuenta de alguien que pertenece también a otra organización (sería tomar una cuenta ajena); solo puede quitarle la membresía. Tampoco puede dar de alta un email ya registrado: el error es genérico («No se pudo crear la cuenta con ese email») para no revelar quién usa UcoMenu. La pertenencia a varias organizaciones se asigna por script/SuperAdmin, no desde el panel.
- **Quién puede qué sobre el personal:** el alta y **subir a Dueño** requieren cuenta que puede escribir (`active`/`grace`); **la baja, bajar de rol y el restablecimiento de contraseña se permiten siempre** (cortar o reducir un acceso no puede depender del pago). El Dueño restablece solo contraseñas de `staff`; la suya y la de otro Dueño las cambia cada uno en `/cuenta`. En la UI el Dueño no se quita ni se baja a sí mismo (la base lo permitiría si queda otro Dueño).
- **Baja:** se borra la membresía; si la persona no tiene otra, se borra también su cuenta de Auth (libera el email y mata los refresh tokens). El acceso se corta al instante porque la autorización sale de `memberships`.
- **Contraseña:** mínimo 10 caracteres (app + `config.toml`). La temporal **no** se fuerza a cambiar en el primer ingreso en este ítem (riesgo registrado).
- **Redirección post-login** (`next`) solo a rutas internas de una lista (`/panel`, `/sala`, `/cuenta`); nunca a URL externas.
- **Mensajes de login genéricos:** «Email o contraseña incorrectos», sin distinguir cuenta inexistente de contraseña errónea.
- **Registro público apagado** en la configuración local (`enable_signup = false`); `admin.createUser` sigue funcionando. En producción hay que replicarlo (ver riesgos).

## Comportamiento y aceptación
**Sesión y login**
- [x] Dado un usuario del seed, cuando entra con email y contraseña correctos, llega a su panel; con datos incorrectos ve el mismo mensaje genérico para cuenta inexistente y para contraseña errónea.
- [x] Sin sesión, `/panel`, `/panel/{slug}/…`, `/sala/…` y `/cuenta` redirigen a `/login?next=…`; tras el login vuelve a la ruta pedida. Un `next` externo o malformado se ignora.
- [x] Cerrar sesión invalida la cookie y las rutas protegidas vuelven a pedir login. Las cookies de sesión son `httpOnly`.
- [x] Un usuario cuya cuenta fue borrada no entra aunque conserve la cookie. _(La renovación automática del token por el proxy **no tiene prueba propia**: ver pendientes.)_
- [x] No hay registro público: `signUp` por la API es rechazado.

**Rutas por rol y organización**
- [x] Owner y staff entran a `/panel/{slug}` y `/sala/{slug}` de su organización.
- [x] El staff no ve en el menú Suscripción ni Personal, y si abre esas URL es redirigido sin ver contenido; el servidor lo impide aunque la UI se manipule.
- [x] Un usuario no miembro de `{slug}` (o con slug inexistente) recibe 404 idéntico.
- [x] Con 0 organizaciones ve un mensaje claro; con 1 entra directo; con 2+ ve el selector y la cabecera permite cambiar. El cambio no filtra datos de la otra organización.

**Aviso de mora**
- [x] `active`: sin aviso. `grace`: aviso con días de atraso y fecha límite (Dueño); `read_only`: aviso de solo lectura; `suspended`: aviso de cuenta suspendida. El staff ve el estado sin plan ni fechas y con «avisale al Dueño».

**Personal (solo Dueño)**
- [x] El Dueño crea un `staff` con email y contraseña temporal; esa persona entra y solo ve lo del staff. Crear un `owner` funciona igual.
- [x] Un email ya registrado → error genérico; no se modifica la cuenta existente (ni su contraseña).
- [x] El Dueño restablece la contraseña de un `staff` que solo pertenece a su organización; la contraseña anterior deja de servir. Si el staff pertenece también a otra organización, se rechaza.
- [x] El Dueño cambia el rol (`staff` ↔ `owner`) y quita personal; el acceso del quitado se corta en el siguiente pedido.
- [x] Un Staff, un Dueño de otra organización o una llamada manipulada **no pueden** ejecutar ninguna de estas acciones (autorización en el servidor).
- [x] Cualquier usuario cambia su propia contraseña en `/cuenta` (pide la actual).
- [x] Con la cuenta en `read_only`/`suspended`: no se puede dar de alta ni subir a Dueño, pero sí quitar personal, bajar de rol y restablecer contraseñas.

**Invariante de dueños (base)**
- [x] No se puede borrar ni bajar de rol al último `owner` de una organización, ni por la API, ni con `service_role`, ni borrando su usuario de Auth. Con otro `owner` activo sí.
- [x] Borrar la organización entera (cascada) y el alta de una organización sin dueños siguen funcionando.
- [x] Dos bajas/descensos simultáneos de los dos únicos dueños dejan al menos uno (serializado por *advisory lock*).

**Seed y desarrollo**
- [x] El seed trae usuarios de ejemplo (owner y staff de cada organización con carta, el de la morosa, y uno con dos organizaciones) con contraseña pública de desarrollo; un script local (`pnpm dev:crear-dueno`) crea un dueño inicial. _(El script se probó a mano —alta, email repetido, organización inexistente, contraseña corta, URL remota rechazada, `--existente`—, sin prueba automática.)_

## Alcance / fuera de alcance
- Incluye: migración (guarda del último dueño); `config.toml` (sin registro público, contraseña mínima); seed con usuarios; `proxy.ts`; módulo de sesión y autorización; `/login`, `/panel`, `/panel/{slug}`, `/panel/{slug}/suscripcion`, `/panel/{slug}/personal`, `/sala`, `/sala/{slug}`, `/cuenta`; acciones de personal; aviso de mora; script de desarrollo; pruebas (unitarias, base, módulo de personal, E2E); ADR 0007; actualización de docs.
- No incluye: recuperar contraseña por correo; invitación por email; forzar el cambio de la contraseña temporal; `/admin` y SuperAdmin; apariencia/configuración de la organización (la ruta heredará el guardia del Dueño cuando exista); gestión de carta, mesas y llamados (el panel muestra el resumen y los enlaces que ya existen); selector con búsqueda; MFA.

## Dependencias y riesgos
- **Sesiones y permisos (nivel C).** Un guardia mal puesto expone el panel de otro local o el de suscripción al staff: por eso la autorización se prueba por rol, por organización y con peticiones manipuladas, y se hacen mutaciones.
- **`service_role` en el servidor** puede todo: el módulo de personal es la única superficie que la usa, comprueba la identidad con el cliente de la persona antes y se prueba con casos adversarios (staff, dueño ajeno, objetivo ajeno, cuenta compartida).
- **Contraseña temporal conocida por el Dueño** y sin cambio forzado: aceptado para el MVP; mitigación: `/cuenta` para cambiarla y, a futuro, bandera de cambio obligatorio.
- **Sin recupero por correo:** si el Dueño único olvida su contraseña, la restablece un operador con acceso al servidor (a futuro, SuperAdmin).
- **Registro público en producción:** hay que apagar el *signup* en el proyecto de Supabase Cloud (panel o configuración); si queda abierto, cualquiera crea una cuenta sin organización (no accede a datos, pero ensucia Auth). Va al checklist de «Salida a producción».
- **Enumeración de emails** acotada: el login es genérico; el alta rechaza duplicados con mensaje genérico. Los límites de intentos son los de Supabase Auth.
- **Token vigente tras la baja:** el JWT de una persona quitada sigue siendo válido hasta 1 h, pero no autoriza nada porque cada pedido consulta `memberships`; al borrar su cuenta, `getUser()` también falla.
- **Organización con `is_active = false`:** el panel sigue accesible para sus miembros (como define el ADR 0005); el tratamiento visual llega con SuperAdmin.
- **Windows/OneDrive:** ruta larga del repo; nada nuevo.

## Evidencias de verificación
Ejecutadas el 2026-10-14 sobre una base recién reseteada (`pnpm db:reset`), migración `20261014013104_last_owner_guard.sql`:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK.
- `pnpm test` **43/43** (20 nuevas: validaciones de email, contraseña y `next`; avisos de mora y lectura de `org_entitlements`).
- `pnpm test:rls` **226/226** en 7 archivos (176 → 226): `owners` (15: último owner por borrado, descenso, traslado y borrado de la cuenta de Auth; con otro owner sí; cascada de la organización; 5 rondas de carrera) y `personnel` (35: alta, rol, baja, restablecer, listado y cambio de la propia contraseña, con Staff, Dueño ajeno, id de otro local, cuenta compartida, email ya registrado, cuenta en gracia/solo lectura/suspendida y compensación del alta). `acl` y `tenancy` ajustadas (nueva función en la matriz; el seed trae miembros). Dos corridas seguidas OK.
- `pnpm test:e2e` **46/46** (16 de la carta + 30 nuevas a 390 px): rutas sin sesión con ruta completa, mensaje de login idéntico, `next` externo y **manipulado en el formulario**, sin registro público, cookie `httpOnly`, Dueño y Staff, 404 idéntico para local ajeno e inexistente, selector con varios locales, avisos de mora en los tres estados para Dueño y Staff (el Staff sin dígitos), cuenta borrada y membresía quitada, ciclo completo de personal (alta, ingreso, restablecer, quitar), email repetido, contraseña corta con el email conservado, único Dueño protegido en la UI, **pantalla abierta de alguien que ya no es Dueño**, cambio de la propia contraseña, sin desborde horizontal.
- **Mutaciones: 22 defensas rotas de a una, 22 detectadas.** Base (3): *trigger* apagado (9 fallas), sin *advisory lock* (2), cascada de organización rota (2). Módulo de personal (9): sin comprobar Dueño (7), objetivo sin acotar a la organización (3), sin cuenta compartida (1), alta sin `can_write` (1), baja que borra la cuenta siempre (1), sin compensación (1), restablecer a un Dueño (1), subir sin `can_write` (1), email existente (1). Aplicación (10): acciones sin `requireOwner`, páginas de Personal y de Suscripción sin `requireOwner`, navegación que muestra secciones al Staff, proxy sin redirección, `requireMembership` sin verificar el slug, `next` sin sanear, cookie sin `httpOnly`, login que revela la causa, selector que no aparece. **Una no se detectaba** (`next` sin sanear en la acción: la página ya lo sanea y tapaba la mutación) y se agregó la prueba del campo manipulado.
- Revisión visual a 390 px (capturas de login, error de login, resumen, suscripción, personal con acciones abiertas, solo lectura, selector, Staff y Mi cuenta): identidad de la carta mantenida, objetivos táctiles de 44 px, sin desborde.
- Sin residuos tras las corridas: 0 organizaciones `tt-*`/`e2e-*` y 0 usuarios `rls-*`/`e2e-*` (se limpiaron a mano los que dejaron corridas interrumpidas).

Pendientes (no ejecutado):
- Revisión independiente (segundo agente, solo lectura): requisito del nivel C antes de integrar.
- Renovación automática del token por el proxy (token vencido); Safari/iOS y dispositivos reales; lector de pantalla; contraste medido con herramienta; `pnpm dev` de punta a punta (la clave de servicio local ya está en `.env.local` por autorización del usuario, pero solo se probó con el build de las pruebas E2E); límites de intentos de Auth; configuración de Supabase Cloud (registro público y contraseña mínima); rendimiento del panel con equipos grandes.
- ~~A confirmar~~ **Confirmado por el usuario (2026-10-14):** el Staff ve un aviso de mora **operativo reducido** (estado y «avisale al dueño», sin plan, montos ni fechas) y el Dueño el completo; `docs/producto.md` ya lo refleja.

## Aprendizajes / cambios de decisión
- **Un layout no se re-ejecuta al navegar entre páginas hijas** (App Router): la autorización va en cada página y cada acción; el layout solo arma la cabecera. Quedó escrito en `session.ts` y en el ADR 0007.
- **Las constantes de clases exportadas desde un módulo `"use client"` llegan como referencia de cliente** a los componentes de servidor y el `className` queda con un mensaje de error. Se movieron a `styles.ts`. Lo detectó la revisión visual (el borde de los botones no aparecía), no las pruebas funcionales: las capturas valen.
- **`[auth.email] enable_signup = false` apaga también el login por email**; el registro público se cierra con `enable_signup = false` en `[auth]`. Los cambios de `config.toml` exigen `pnpm db:stop` y `pnpm db:start` (`db reset` no recarga Auth): la primera prueba mostró el registro aún abierto y se borró el usuario de prueba que creó.
- **El `proxy` hace el redirect de «sin sesión»**: sin él, el layout redirigía con la ruta del local y se perdía la página profunda pedida (`/personal`). Sigue sin autorizar.
- **Next trae su propio `role="alert"`** (anunciador de rutas): las pruebas acotan el aviso al formulario.
- **Una mutación sin detectar enseñó una defensa sin prueba**: la acción de login vuelve a sanear `next` aunque la página ya lo haga, porque el campo oculto es manipulable.
- **Bajar de rol siempre se permite** (la ficha decía que todo cambio de rol exigía cuenta al día): reducir un acceso no puede depender del pago.
- Windows: `process.exit()` con conexiones abiertas dispara `Assertion failed: UV_HANDLE_CLOSING`; el script de dueño sale con `process.exitCode`. Una corrida de Vitest perdió un *worker* una vez (código `0xC0000409`) y las dos siguientes pasaron; se registra como inestabilidad del entorno, sin causa conocida.
- Restablecer la contraseña de alguien **no revoca sus sesiones abiertas** (la baja sí, porque borra la cuenta); queda como riesgo aceptado del MVP.
- El día de mora es el techo de las 24 h: 3 días y unos segundos de atraso es el *día 4*; el dato de prueba del E2E usa 2 d 23 h.

## (C) Invariantes
1. La autorización sale siempre de `memberships`, por pedido; nunca del JWT, de `user_metadata` ni de una cookie de «organización activa».
2. Una organización con dueños nunca queda sin `owner` por una baja o un descenso, por ningún camino (API, servidor, cascada de usuario).
3. Un Dueño solo opera sobre personas **de su organización**, y nunca toma la cuenta (contraseña, borrado) de alguien que pertenece a otra.
4. La clave `service_role` no sale del servidor ni se usa fuera del módulo de personal y los scripts locales.
5. Ninguna ruta de `/panel` ni `/sala` responde con datos a un pedido sin sesión válida y membresía vigente del `slug` pedido.
6. El Staff nunca recibe plan, fechas, facturación ni lista del personal.
7. Cortar un acceso (baja, restablecer contraseña) no depende del estado de pago.

## (C) Fallas y manejo de errores
- Credenciales inválidas: mensaje genérico, sin pista. Demasiados intentos: el mensaje de Supabase se traduce a «Demasiados intentos, probá en unos minutos».
- Alta: si falla la creación de la membresía tras crear el usuario, se **compensa** borrando el usuario recién creado; si la compensación falla, se registra en el log del servidor con el id (no el email) para limpieza manual.
- Alta con email existente: error genérico, sin tocar la cuenta existente.
- Baja del último `owner`: la base rechaza con `23514` / `last_owner_required`; la UI muestra «Tiene que quedar al menos un Dueño».
- Sesión vencida o usuario borrado: redirección a `/login`.
- Falta `SUPABASE_SERVICE_ROLE_KEY`: las acciones de personal fallan cerradas con un error de configuración; el login y la lectura siguen funcionando.
- Dos acciones simultáneas sobre los dos únicos dueños: serializadas por *advisory lock*; la segunda ve el estado ya cambiado.
- Reintentos: crear dos veces el mismo email → el segundo es «ya existe» (sin efectos); restablecer contraseña es idempotente.

## (C) Seguridad y permisos
| Acción | Sin sesión | Staff | Owner (su org) | Owner/otros (otra org) |
| --- | --- | --- | --- | --- |
| Ver `/panel/{slug}` y `/sala/{slug}` | login | sí | sí | 404 |
| Ver Suscripción y Personal | login | redirige | sí | 404 |
| Alta / cambio de rol | — | no | sí (con `can_write`) | no |
| Baja / restablecer contraseña de staff | — | no | sí (siempre) | no |
| Cambiar la propia contraseña | — | sí | sí | — |

Amenazas: ruta protegida solo en la UI; IDOR por `slug`/`membership_id` de otra organización; Staff llamando a una acción con la UI manipulada; Dueño tomando una cuenta compartida; alta sobre un email existente (sobreescritura de contraseña); *open redirect* en `next`; cookie legible por JS; fuga de la clave `service_role` al navegador; condición de carrera sobre los dos únicos dueños; sesión de una persona quitada; enumeración de emails.

## (C) Migración y rollback
- Migración nueva y aditiva: una función y un *trigger* sobre `memberships`; no toca datos. Seed y `config.toml` locales. Solo local; **nada contra proyectos remotos**.
- Rollback: `git revert` + `pnpm db:reset`. En una base con datos: `drop trigger` y `drop function` de la guarda; las cuentas creadas siguen válidas.

## (C) Aceptación explícita del riesgo
- El usuario fijó las seis decisiones y el alcance el 2026-10-14 y pidió ejecutar el ítem con `agile-iterar`. Operación solo local. La revisión de nivel C se pedirá a un segundo agente (solo lectura) antes de integrar.
