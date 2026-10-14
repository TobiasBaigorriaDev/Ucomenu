# 0007 — Acceso del personal: sesión por cookies, rol por membresía y alta desde el servidor

- Estado: aceptada
- Fecha: 2026-10-14

## Contexto
El ADR 0005 fija que la autorización sale de `memberships` y que solo el servidor las escribe. Faltaba decidir cómo entra la gente (login y sesión), cómo se protege cada ruta, cómo se da de alta y de baja al personal sin abrir una superficie de escalada, y cómo se evita dejar a una organización sin Dueño.

## Decisión
1. **Login por email y contraseña, sin registro público** (`enable_signup = false` en `[auth]`; el proveedor de email sigue encendido). Las cuentas las crea el servidor.
2. **Sesión por cookies `httpOnly` con `@supabase/ssr`** y **sin cliente de Supabase en el navegador**: login, cierre y cambios son *server actions*. `proxy.ts` solo **renueva** la sesión y manda a `/login` a quien no tiene ninguna (conservando la ruta pedida); **no autoriza**.
3. **Identidad con `getUser()`** (valida contra Auth) y **rol con una consulta a `memberships` en cada pedido**, nunca del JWT. Cada `page.tsx` y cada *server action* exige su propio nivel (`requireMembership` / `requireOwner`): un layout no se re-ejecuta al navegar entre páginas hijas, así que no alcanza como guardia.
4. **La organización activa vive en la URL** (`/panel/{slug}/…`, `/sala/{slug}`), no en una cookie. Un no miembro y un slug inexistente reciben el mismo 404.
5. **Alta, baja, rol y contraseña del personal las hace el servidor con `service_role`**, pero solo después de comprobar con el cliente de la **persona** (RLS) que es `owner` de esa organización, y acotando el objetivo a esa organización. No se agregan funciones `SECURITY DEFINER` en `public` ni permisos de escritura sobre `memberships`.
6. **Nunca se toma una cuenta ajena**: no se restablece la contraseña ni se borra la cuenta de alguien que pertenece a otra organización, ni se da de alta sobre un email ya registrado (error genérico). Restablecer solo vale para `staff`.
7. **Invariante de dueños en la base** (`guard_last_owner`, *trigger* con *advisory lock*): no se puede borrar, bajar de rol ni mover al último `owner`, ni siquiera con `service_role` ni borrando su usuario de Auth. La cascada de borrar la organización entera sí se permite.
8. **Cortar un acceso no depende del pago**: baja y restablecer contraseña siempre; alta y subir a Dueño solo con la cuenta al día.

## Alternativas consideradas
- **Funciones SQL `SECURITY DEFINER` para gestionar membresías por la API** (previstas en el ADR 0005) — la creación del usuario de Auth tiene que pasar por el servidor igual, y cada función en `public` es API pública a mantener y auditar. Se prefirió un único módulo de servidor con pruebas adversarias y el invariante en la base.
- **Organización activa en cookie** — estado oculto, dos pestañas pisándose y una cookie más que validar.
- **`getClaims()` como identidad** — verifica la firma sin ir a Auth: una cuenta borrada seguiría entrando hasta que venza el token. Se usa solo en el *proxy*, para renovar.
- **Invitación por email** — requiere un servicio de correo (tercero); queda para cuando se contrate.
- **Forzar el cambio de la contraseña temporal** — mejora la seguridad pero agrega estado (bandera en `app_metadata`) y una pantalla de bloqueo; fuera de este ítem.

## Consecuencias
- Todo código nuevo bajo `/panel` o `/sala` debe llamar a `requireMembership`/`requireOwner` en la página y en cada acción, y se prueba por rol y por organización.
- `service_role` queda confinada al módulo de personal y a los scripts de `tools/`; la variable `SUPABASE_SERVICE_ROLE_KEY` es solo de servidor.
- **En producción hay que apagar el registro público** en el proyecto de Supabase Cloud y replicar la contraseña mínima de 10 caracteres.
- La contraseña temporal la conoce el Dueño y no se fuerza a cambiar; sin recupero por correo, el Dueño único que olvida la suya depende de un operador (a futuro, SuperAdmin).
- Restablecer la contraseña no revoca las sesiones abiertas de esa persona (sí lo hace la baja, que borra la cuenta).
- El JWT de una persona quitada sigue siendo válido hasta 1 h, pero no autoriza nada: cada pedido consulta `memberships`.
