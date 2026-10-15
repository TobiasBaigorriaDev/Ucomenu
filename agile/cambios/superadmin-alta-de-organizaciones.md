# Cambio: SuperAdmin mínimo — alta de una organización con su Dueño y su plan, con registro de quién la hizo
Estado: integrado a `main` (squash, 2026-10-15; sin subir a GitHub)
Nivel: C (permisos: nace un rol de plataforma; dinero: asigna plan y vigencia; datos: crea cuentas y un registro de auditoría que no se borra)

## Objetivo
Que una persona del equipo de UcoMenu (el **SuperAdmin**) pueda, desde `/admin`, **dar de alta una organización** con su **Dueño** inicial y su **plan**, y que quede un **registro inmutable de quién lo hizo y qué se cambió**. Hoy esto solo se hace por script local (`pnpm dev:crear-dueno`) o con `service_role` a mano, sin rastro. Es el primer pedazo del ítem «SuperAdmin» del tablero; el resto (cambiar/suspender plan, pagos, borrado) va en incrementos propios.

## Decisiones tomadas por mí — **confirmadas por el usuario el 2026-10-15**
1. **Dueño inicial = cuenta nueva** con contraseña temporal (misma regla que el alta de personal: ≥ 10 caracteres, se la pasa el SuperAdmin a la persona). Si el email **ya tiene cuenta**, el alta se rechaza con un mensaje claro (el SuperAdmin es de confianza, así que sí se le dice) y **no se toca esa cuenta**. «Sumar una cuenta existente como Dueño de otra organización» queda como ítem aparte.
2. **Plan = plan + ciclo (mensual/anual) + «vigente hasta»** (fecha; por defecto hoy + 14 días, como la prueba). Reemplaza la prueba automática: `plan_code`, `billing_cycle`, `current_period_end = fecha elegida` y `trial_ends_at = null`. Así la fecha elegida es el fin efectivo (si no, `greatest(...)` seguiría usando los 14 días del trigger). Tope: de «mañana» a 2 años (pura sanidad: evita un fin de 2099 por un error de tipeo).
3. **La fecha se interpreta como el final de ese día en Argentina** (23:59:59, UTC−3, la zona que ya usa la app).
4. **Sin sucursal inicial.** La primera sucursal, la primera carta y los QR son el ítem «Alta guiada del dueño» (el panel todavía no tiene gestión de sucursales). Hasta entonces la carta pública de la organización nueva da 404 (no hay `/m/{org}/{sucursal}`) y el Dueño entra a un panel vacío.
5. **`platform_admins` se alimenta solo por SQL del operador** (nadie lo escribe por la API ni desde la app). No hay pantalla para nombrar SuperAdmins.
6. **Quién lee la auditoría: solo los SuperAdmin.** La arquitectura prevé que el Dueño lea la de su organización; queda para cuando haya algo que mostrarle (cambios de plan, pagos).
7. **El email del Dueño no se guarda en el registro** (es un dato personal en una tabla que no se puede borrar): solo su `user_id`. El del actor (personal de UcoMenu) sí se guarda como instantánea, para que el registro siga siendo legible aunque esa cuenta se dé de baja.

## Comportamiento y aceptación
- [ ] Dado un SuperAdmin con sesión, cuando completa nombre, slug, email y contraseña temporal del Dueño, plan, ciclo y fecha, entonces existe la organización (activa), una cuenta de Auth con ese email, una membresía `owner`, una suscripción con ese plan/ciclo/fecha (sin `trial_ends_at`) y **una fila de auditoría** con el actor, la acción `organization.created`, la organización y el «después».
- [ ] Todo lo anterior ocurre en **una sola transacción de base** (organización, membresía, suscripción, auditoría): si algo falla no queda nada a medias. La cuenta de Auth (que no es transaccional) se borra si la transacción falla.
- [ ] El Dueño nuevo entra con ese email y contraseña a `/panel/{slug}` y ve el plan y la fecha elegidos en «Suscripción».
- [ ] Quien **no** es SuperAdmin (Dueño, Staff, sesión sin rol, anónimo) no puede: abrir `/admin` (404 con sesión, login sin sesión), ejecutar la acción, ni llamar la función de la base por la API (`42501`). Sin que la respuesta confirme que `/admin` existe.
- [ ] Slug repetido, slug inválido, email repetido o inválido, contraseña débil, plan/ciclo inválido y fecha pasada o a más de 2 años dan un error claro y **no dejan nada** (ni cuenta de Auth, ni organización, ni auditoría).
- [ ] La auditoría **solo se agrega**: ni la API, ni `service_role`, ni un `UPDATE`/`DELETE`/`TRUNCATE` directo pueden modificarla. Solo la leen los SuperAdmin.
- [ ] `/admin` lista las organizaciones (nombre, slug, plan, **estado de la cuenta —al día, gracia, solo lectura o suspendida, con la misma regla de mora que la base—**, vigencia, Dueño) y los últimos movimientos de la auditoría; un slug de 64 caracteres sin guiones no desborda a 390 px.

## Alcance / fuera de alcance
- Incluye: tablas `platform_admins` y `audit_log`; función de base `admin_create_organization` (solo `service_role`); módulo `src/lib/admin/organizations.ts`; guardia `requirePlatformAdmin`; `/admin` (lista + auditoría) y `/admin/nueva` (formulario); SuperAdmin de ejemplo en el seed; pruebas unitarias, de RLS y E2E; ADR 0013.
- No incluye: cambiar/suspender/reactivar plan, add-ons, registro de pagos, prueba de 14 días como concepto aparte, desactivar o **borrar** organizaciones (sigue bloqueado por `price_history`, ADR 0012), sumar una cuenta existente como Dueño, primera sucursal, lectura de la auditoría por el Dueño, pantalla para nombrar SuperAdmins, MFA, cola de soporte.

## Dependencias y riesgos
- Depende de planes y entitlements (hecho) y de Auth. Ningún cambio a esquemas ni políticas existentes.
- **Riesgo principal:** el SuperAdmin usa `service_role`, que se salta RLS. Mitigación: (a) la identidad se prueba con la **sesión de la persona** (RLS sobre `platform_admins`) antes de usar la clave de servicio; (b) la función de base **vuelve a comprobar** que `p_actor` es SuperAdmin, así que una `service_role` usada sin esa comprobación no alcanza para crear organizaciones «a nombre» de alguien que no lo es; (c) la función no está concedida a `anon` ni `authenticated`.
- `p_actor` lo pasa el servidor: la defensa es que **solo `service_role` puede llamar la función** (secreto del servidor). Quien tenga esa clave ya puede todo; la auditoría no lo protege de eso (límite aceptado, igual que `changed_by` NULL en ADR 0012).
- La cuenta de Auth se crea antes que la transacción: si el proceso muere entre ambos pasos queda una cuenta sin organización (inofensiva, sin membresía). Se limpia a mano; se registra con `console.error` cuando la compensación falla.
- Contraseña temporal sin cambio forzado (deuda ya conocida del acceso del personal).

## (C) Invariantes
1. Toda organización creada por SuperAdmin tiene **exactamente** un Dueño, una suscripción con el plan y la fecha pedidos y **una fila de auditoría** de su creación (misma transacción).
2. Una fila de `audit_log` **nunca** se modifica ni se borra por ningún camino de la aplicación o de la API (trigger de solo-agregado + privilegios revocados, también a `service_role`).
3. Nadie que no esté en `platform_admins` puede crear una organización por esta vía; `platform_admins` no se escribe por la API.
4. `audit_log.actor_id` sale de la sesión validada del servidor (`getUser()`), nunca de un campo del formulario.
5. No se altera ninguna organización, suscripción ni membresía existente.

## (C) Fallas y manejo de errores
| Falla | Resultado |
| --- | --- |
| Email ya registrado en Auth | Error claro; no se crea nada. |
| Slug repetido (`23505` en `organizations.slug`) | Error claro; la cuenta de Auth recién creada se borra. |
| Cualquier error de la función de base | Rollback de la transacción; se borra la cuenta de Auth; mensaje genérico. |
| Falla al borrar la cuenta de Auth huérfana | `console.error` con ids; no se oculta el error original al usuario. |
| Se pierde la respuesta de la función (red cortada, tiempo agotado: error sin SQLSTATE) | **Resultado incierto**: no se asume rollback. Se busca la organización por slug con la cuenta recién creada como Dueño: si existe, éxito (la cuenta no se borra); si no existe, se compensa; si ni siquiera se puede averiguar, «uncertain» (no repetir; mirar la lista) y no se borra nada. Si el borrado de la cuenta es rechazado (la guarda del último Dueño, porque el alta se confirmó entre la comprobación y el borrado), se **vuelve a reconciliar** antes de responder: éxito, o «uncertain»; nunca «no se creó nada» con el alta hecha. Un error con SQLSTATE sí es rollback seguro y compensa directo. |
| Doble envío del formulario | El segundo falla por slug repetido o email ya registrado (idempotente en efecto: no duplica). |
| Sin `SUPABASE_SERVICE_ROLE_KEY` | Mensaje «SuperAdmin no está configurado en este servidor»; no se crea nada. |
| Falla de la base al listar | Aviso en la página, sin romperla. |

## (C) Seguridad y permisos
- Amenaza: un Dueño o Staff intenta abrir `/admin` o llamar la acción o la RPC. → `requirePlatformAdmin` (404) en la página y en la acción; la RPC no tiene `EXECUTE` para `authenticated`/`anon`; la tabla `platform_admins` no tiene escritura por la API; las pruebas de RLS lo verifican.
- Amenaza: elevarse insertándose en `platform_admins`. → sin `INSERT` para ningún rol de la API; solo `postgres` (operador).
- Amenaza: borrar rastro. → `audit_log` solo se agrega (ver invariante 2). Una purga deliberada exige apagar el trigger como dueño de la tabla, igual que `price_history`.
- Datos personales: el registro guarda el `user_id` del Dueño, no su email.
- El `proxy` solo renueva sesión y redirige al login; **no autoriza**. La autorización es de cada página y de la acción.
- **Primer SuperAdmin en un entorno real** (a mano, con acceso a la base, nunca desde la app): `insert into public.platform_admins (user_id) select id from auth.users where email = '<email>';`. Requiere aprobación humana (toca producción cuando exista).

## (C) Migración y rollback
- Migración aditiva `20261014210000_superadmin_alta_de_organizaciones.sql`: dos tablas, tres funciones, políticas y permisos nuevos. No toca datos existentes. Se aplica con `pnpm db:reset` en local.
- Rollback (local): `git revert` + `pnpm db:reset`. En una base con datos (se pierde la auditoría):
  `drop function public.admin_create_organization(...), private.is_platform_admin(), private.audit_log_append_only(); drop table public.audit_log, public.platform_admins;`. Las organizaciones creadas **no** se borran (quedan válidas).
- Nada contra proyectos remotos.

## (C) Aceptación explícita del riesgo
- Alcance pedido por el usuario el 2026-10-14 («Empezar por crear una organización, asignarle un dueño y un plan, y registrar quién hizo el cambio»). **El usuario confirmó las 7 decisiones de arriba el 2026-10-15.** La tercera ronda de Codex (sobre `f96e940`) aprobó sin hallazgos nuevos.
- Aclaración acordada: la prueba automática de 14 días (trigger de planes) sigue existiendo para toda organización creada fuera del SuperAdmin; el alta de SuperAdmin la reemplaza por el plan y la fecha elegidos (por defecto, 14 días). La base no distingue «en prueba» de «pagado»: ese concepto es el ítem aparte del tablero.

## Evidencias de verificación
- Pruebas ejecutadas (2026-10-14/15, base compartida reseteada con la migración nueva), **después de corregir la revisión de Codex**: typecheck · `eslint src e2e tests playwright.config.ts` · build OK · unitarias **251/251** (31 en `src/lib/admin/admin.test.ts`, 3 de `billingState`, el caso de `/admin` en `safeNext`) · RLS **457/457** (18 archivos; 46 en `tests/rls/admin.rls.test.ts` y 2 en `acl.rls.test.ts`) · E2E **167/167 en dos corridas completas seguidas** (varias corridas intermedias perdieron un *worker* con `0xC0000409`, el problema conocido de Windows, en archivos ajenos a este cambio; no cuentan) · sin residuos `tt-*`/`e2e-*` ni auditoría de prueba.
- **Mutaciones (defensas rotas de a una): 28 probadas, 26 detectadas y 2 equivalentes.** Base: función sin comprobar al SuperAdmin, sin `trial_ends_at = NULL`, auditoría con el email del Dueño o con otro actor, alta sin membresía, sin validar período ni plan, sin trigger de solo-agregado (UPDATE/DELETE y TRUNCATE), `EXECUTE` a `anon` y a `authenticated`, escritura a `audit_log` y a `platform_admins` por `service_role`/`authenticated`, lectura de `platform_admins` y `audit_log` abierta (a todos y a `anon`). Aplicación: `listOrganizations` sin comprobar, sin compensar la cuenta de Auth, sin validar período ni contraseña, slug sin minúsculas, fin del día en UTC, `safeNext` sin `admin`, actor tomado de un campo. **Equivalentes (defensa en profundidad):** (1) quitar la guarda de `layout.tsx` — el 404 de una página sube al `not-found` de la raíz, así que el marco de `/admin` no se dibuja igual; la guarda queda como segunda barrera; (2) quitar a la vez `requirePlatformAdmin` de la acción y `isPlatformAdmin` de `createOrganization` — la función de base rechaza al actor (`42501`) y no se crea nada, lo que prueba que la base sola alcanza.
- **Segunda ronda de Codex (sobre `7504b5d`):** quedaba la carrera «la respuesta se pierde mientras la función sigue ejecutándose; la comprobación no ve el alta; el alta se confirma; el borrado de la cuenta lo frena la guarda del último Dueño y se respondía "No se creó nada"». Los datos estaban protegidos, la respuesta era incorrecta. Ahora, si el borrado falla en el camino incierto, se vuelve a reconciliar. Prueba nueva (la función real se ejecuta justo antes del borrado) y la mutación «sin la re-comprobación» la detecta. Mutaciones en total: 33 detectadas y 2 equivalentes.
- **Mutaciones de la corrección:** 6 más, las 6 detectadas (compensar siempre; tratar «no se pudo comprobar» como rollback; reconciliar sin mirar al Dueño —detectada recién al agregar la prueba de la carrera por el slug—; borde de gracia exclusivo; borde de solo lectura a 14 días; listado que ignora el estado) y la prueba E2E del slug largo falla si se saca `break-words`.
- Pendientes (no ejecutados): segunda ronda de Codex; revisión visual de `/admin` y `/admin/nueva` en un teléfono real (solo se comprobó que no desbordan a 390 px); sonda contra HTTPS/producción (no existe); lector de pantalla.

## Aprendizajes / cambios de decisión
- La guarda del `layout` de `/admin` **no** evita que el 404 se dibuje dentro del marco (lo asumí al escribirla y la mutación lo desmintió): el `not-found` de la raíz lo reemplaza. Se corrigió el comentario; la guarda queda como segunda barrera.
- El `proxy` y `safeNext` ahora conocen `/admin`: antes `/admin` figuraba en las pruebas como destino inválido (`acceso.spec.ts` y `validation.test.ts`); se cambiaron por una ruta realmente desconocida (`/configuracion`, `/adminx`).
- Un SuperAdmin que entra sin `next` cae en `/panel` (sin locales: «tu cuenta no tiene ningún local»). Anotado en el tablero.
- **Revisión de Codex (sobre `a4e7257`), los tres puntos corregidos:** (1) *resultado incierto del alta*: cualquier error de la función se tomaba por rollback; si se perdía la respuesta tras el commit, se intentaba borrar al Dueño y se decía «no se creó nada». Ahora solo un error con SQLSTATE es rollback seguro; el resto se reconcilia antes de compensar (tabla de fallas). (2) *Estado de la cuenta*: el listado mostraba solo «venció el»; ahora `billingState` (misma regla que `private.billing_state`, comparada en los bordes con la función real en una prueba de RLS para que no se desvíe) muestra Al día / gracia / solo lectura / suspendida. (3) *Slug largo en móvil*: confirmado como desborde real; `break-words` en listado y auditoría. Mi prueba de desborde anterior (`scrollWidth - innerWidth`) daba falsos aprobados en emulación móvil: reemplazada por la medida de `historial-precios.spec.ts`.
- Dos `docker exec`/`db:reset` simultáneos rompen la base compartida (`DbSetupError`): lanzar la cadena de verificación **una sola vez**.
