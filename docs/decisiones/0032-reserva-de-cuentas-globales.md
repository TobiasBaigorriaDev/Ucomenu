# 0032 — Las operaciones globales sobre una cuenta de Auth se coordinan con una reserva en la base; las cuentas de SuperAdmin no se tocan desde un local

- Estado: aceptada (aprobada por el usuario y desplegada en staging el 2026-10-21)
- Fecha: 2026-10-21

## Contexto
Una persona es **una** cuenta de Auth con varias membresías. El Dueño de un local puede cambiar la contraseña o dar de baja a su personal, y eso toca la cuenta **global**: la contraseña vale para todos los locales y borrar la cuenta borra (en cascada) todas sus membresías. Hasta ahora se protegía con «¿tiene otra membresía?» (un `SELECT`) seguido de una llamada HTTP a la API de Auth. Dos defectos:

1. **Un SuperAdmin con membresía de local** (por ejemplo, sumado como Dueño de un local y luego bajado a Staff por ese Dueño) quedaba al alcance del Dueño: restablecer su contraseña o darlo de baja (que borra la cuenta y, por la cascada de `platform_admins`, su rol de plataforma).
2. **Carrera**: entre el `SELECT` y la llamada a Auth, `admin_add_owner` podía sumar la cuenta a otro local. Resultado: se cambiaba la contraseña de una cuenta que ya era de otro local, o se borraba la cuenta y se perdía en silencio la membresía recién creada (con una auditoría «added» que ya no era cierta). Repetir el `SELECT` no sirve: la llamada a Auth no está en la transacción.

## Decisión
1. **Reserva por cuenta** (`private.account_leases`, 2 minutos). `personnel_begin_reset` y `personnel_remove_member` (funciones `SECURITY DEFINER`, solo `service_role`, que vuelven a exigir un Dueño de la organización) hacen la comprobación definitiva **y** toman la reserva en una transacción, bajo un advisory lock por cuenta. Quien suma membresías (trigger `BEFORE INSERT` en `memberships` y, para el ascenso, `admin_add_owner`) toma el mismo lock y se niega con `account_busy` (`55006`) mientras haya una reserva vigente. Sin tercer orden posible: o la membresía se confirma antes (y la comprobación ve «cuenta compartida» y no toca Auth) o la reserva se toma antes (y la membresía espera y se rechaza).
2. La reserva se libera al terminar la llamada a Auth (también si falla) y **vence sola** si el servidor muere en el medio. Borrar la cuenta la elimina en cascada.
3. **Una cuenta de SuperAdmin nunca se toma desde un local**: el restablecimiento se rechaza con el mismo error que una cuenta compartida (no se revela quién es de la plataforma) y la baja le quita la membresía pero conserva la cuenta.
4. `platform_admins.user_id` **conserva `ON DELETE CASCADE`**; la protección está en los dos únicos caminos de la aplicación que cambian o borran una cuenta.

## Alternativas consideradas
- **`ON DELETE RESTRICT` en `platform_admins`** — protegería solo el borrado, no el cambio de contraseña; y rompería el contrato actual (el operador quita un SuperAdmin borrando su cuenta; lo prueba `admin.rls.test.ts`) y la limpieza de las pruebas.
- **Bloquear solo `admin_add_owner`** para cuentas con membresías — no cubre cuentas de plataforma que ya tienen membresía ni la ventana entre la comprobación y Auth.
- **Repetir el `SELECT` justo antes de llamar a Auth** — achica la ventana pero no la cierra.
- **Cambiar contraseña y borrar la cuenta con SQL directo sobre `auth.users`** (todo en la transacción) — atómico, pero esquiva a GoTrue (hash de contraseña, sesiones, identidades) y acopla la aplicación al esquema interno de Auth.
- **Bloqueo con una transacción abierta durante la llamada HTTP** — PostgREST no mantiene transacciones entre pedidos.

## Consecuencias
- Una cuenta sumada a otro local entre la comprobación y Auth ya no se toma ni se borra; el SuperAdmin recibe «la cuenta tiene otra operación en curso» y reintenta (segundos).
- **Residuos aceptados:** (a) si la llamada a Auth se cuelga más de 2 minutos la reserva vence y la ventana se reabre (sin timeout propio en el SDK); (b) una baja que coincide con otra operación global sobre la misma cuenta la deja sin local pero sin borrarla (inofensiva; se registra en el log); (c) el operador que agrega un SuperAdmin con SQL mientras se le cambia la contraseña no está coordinado; (d) el resto de las acciones de Auth que no pasan por estas funciones (alta de personal, alta de organización) siguen como estaban.
- Nueva tabla privada, tres funciones y un trigger; `admin_add_owner` gana una llamada. Rollback en la cabecera de la migración.
