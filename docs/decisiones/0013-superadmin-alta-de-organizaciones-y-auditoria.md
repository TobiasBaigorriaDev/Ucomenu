# 0013 — SuperAdmin: rol de plataforma en tabla, alta de organizaciones en una función de base y auditoría de solo-agregado

- Estado: aceptada (el usuario confirmó el 2026-10-15 las 7 decisiones de la ficha `superadmin-alta-de-organizaciones`; falta la tercera ronda de Codex sobre el código)
- Fecha: 2026-10-14

## Contexto
Hasta hoy las organizaciones y sus primeros Dueños se crean por script local (`pnpm dev:crear-dueno`) o con `service_role` a mano, sin dejar rastro de quién hizo qué. El producto exige un SuperAdmin que dé de alta organizaciones, asigne planes y deje **auditados** esos cambios (`producto.md`, módulo 6). `service_role` se salta RLS, así que lo que haga el SuperAdmin no puede apoyarse en las políticas: hay que decidir cómo se prueba quién es, dónde ocurre el cambio y cómo se registra sin que se pueda reescribir.

## Decisión
1. **Rol de plataforma en una tabla**, `platform_admins (user_id)`: lo lee solo su propia persona (RLS) y **nadie lo escribe por la API ni con `service_role`** (privilegios revocados); lo agrega el operador con SQL. Ni el JWT ni `user_metadata` otorgan el rol.
2. **Identidad en dos pasos**: el servidor prueba quién es el actor con **la sesión de la persona** (lee su propia fila de `platform_admins` con RLS) y recién entonces usa `service_role`; el actor sale de `getUser()`, nunca de un campo. `/admin` responde el mismo 404 que una ruta inexistente a quien no es SuperAdmin.
3. **El cambio ocurre en una función de base**, `public.admin_create_organization(...)`: crea la organización, ajusta la suscripción (que ya creó el trigger de la prueba de 14 días), agrega la membresía del Dueño y escribe la auditoría **en una sola transacción**. Solo `service_role` puede ejecutarla (ni `anon` ni `authenticated`, aunque sean SuperAdmin) y **vuelve a comprobar** que el actor está en `platform_admins`. La cuenta de Auth del Dueño se crea antes (Auth no es transaccional) y se borra si la función falla.
4. **Auditoría de solo-agregado**: `audit_log (actor_id, actor_email, action, organization_id, before, after)` con la misma técnica que `price_history` (ADR 0012): trigger que rechaza `UPDATE`/`DELETE`/`TRUNCATE`, privilegios de escritura revocados incluso a `service_role`, sin claves foráneas hacia la persona ni la organización para que el registro sobreviva a sus bajas. Solo la leen los SuperAdmin. No guarda el email del Dueño (dato personal en una tabla que no se puede borrar); del actor guarda una instantánea del email.
5. **Plan = plan + ciclo + «vigente hasta»**, que reemplaza la prueba automática (`trial_ends_at = NULL`) para que el fin efectivo sea el elegido.

## Alternativas consideradas
- **`platform_admins` por `app_metadata`/`user_metadata` del JWT** — `user_metadata` lo edita la propia persona y el JWT no se revoca al instante; rompe el criterio de ADR 0005 (autorización desde tablas, en cada pedido).
- **Políticas RLS para que un SuperAdmin escriba organizaciones y suscripciones con su propia sesión** — ampliaría la superficie de la API (cualquier cliente con el JWT de un SuperAdmin escribiría) y mezclaría el rol de plataforma con las políticas de tenant. El servidor con `service_role` y una función acotada deja una sola puerta.
- **Varias escrituras desde la aplicación con `service_role`** (organización, suscripción, membresía, auditoría por separado) — no son atómicas y la auditoría se podría omitir; descartado.
- **Registrar la auditoría desde la aplicación** (insert aparte) o con triggers sobre cada tabla — la primera se puede saltear y no comparte transacción; la segunda no sabe quién es el actor cuando el pedido llega con `service_role` (`auth.uid()` es NULL). La función recibe el actor explícito y escribe la fila.
- **Un `audit_log` por tipo de cambio, tipado** (como `price_history`) — para cambios heterogéneos (alta, plan, pagos, suspensión) conviene un registro genérico con `before`/`after`; `price_history` quedó tipado por ser un solo hecho con enteros y un índice por plato.
- **Mostrar el email del Dueño en el registro** — facilita la lectura pero fija un dato personal en una tabla de solo-agregado; se prefirió el `user_id`.

## Consecuencias
- Quien tenga la clave `service_role` puede llamar la función con cualquier `p_actor` que sea SuperAdmin: la auditoría **no protege** de una clave de servicio comprometida (límite aceptado, como el `changed_by NULL` de ADR 0012). Lo que sí garantiza: sin ser SuperAdmin registrado no se crea nada, y lo creado queda registrado.
- Primer SuperAdmin de un entorno real: `insert into public.platform_admins (user_id) select id from auth.users where email = '<email>'`, a mano y con aprobación (toca producción cuando exista). En local lo carga el seed (`admin@ucomenu.test`).
- Una organización con auditoría **sí se podrá borrar** el día que exista ese borrado (sin clave foránea); su retención se define aparte. El borrado sigue bloqueado por `price_history` (ADR 0012).
- Cada acción nueva de SuperAdmin (cambiar/suspender plan, pagos, add-ons) sigue el mismo patrón: función de base acotada, solo `service_role`, vuelve a comprobar al actor, escribe `audit_log` en la misma transacción; se agrega su valor al `check` de `action`.
- Lectura de la auditoría por el Dueño de la organización (prevista en `arquitectura.md`): pendiente, cuando haya movimientos que mostrarle.
- El Dueño inicial es una cuenta nueva con contraseña temporal sin cambio forzado (deuda ya conocida). Sumar una cuenta existente como Dueño de otra organización queda para otro incremento.

## Ampliación (2026-10-17): plan, suspensión y pagos a mano
Ficha: `agile/cambios/superadmin-planes-pagos.md`. Mismo patrón que el alta; lo nuevo:
- **Una función de base por acción** (`admin_change_plan`, `admin_set_suspension`, `admin_register_payment`): solo `service_role`, vuelven a comprobar al actor, toman un lock de la fila de la suscripción (`FOR UPDATE`) y escriben `audit_log` en la misma transacción. Los errores tienen un mensaje estable que la aplicación traduce; un error sin SQLSTATE (red cortada) se trata como **resultado incierto**, nunca como éxito ni como fallo seguro.
- **La suspensión manual es un dato aparte** (`subscriptions.suspended_at`) que manda en `private.org_state` sobre las fechas. No se mezcla con la mora ni mueve fechas.
- **`payments` solo se agrega** (igual que `audit_log`: trigger y privilegios revocados, también a `service_role`) y la leen solo los SuperAdmin. Sus claves foráneas son `RESTRICT`: una organización con pagos no se borra en cascada. **El borrado de organizaciones, cuando exista, tiene que definir antes la retención de pagos** (igual que `price_history`).
- **Un pago nunca acorta ni repite la vigencia**: «cubre hasta» debe ser posterior al fin efectivo y a ahora; `unique (subscription_id, covers_until)` es la defensa final contra el doble registro.
- **La prueba de 14 días tiene estado derivado propio** (`private.trial_status`), separado del de mora; su vencimiento sigue la regla de mora de ADR 0006.
- El motivo de cada cambio y la acción viajan en `audit_log.after`; la referencia de un pago **no** se copia allí (puede traer datos de terceros en una tabla que no se borra).

