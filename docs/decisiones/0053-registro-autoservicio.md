# 0053 — Los dueños se registran solos: correo o Google, prueba de Pro y plan elegido al pagar

- Estado: aceptada (decisiones de negocio aprobadas por el usuario el 2026-11-01)
- Fecha: 2026-11-01

## Contexto
El alta depende de una persona: el interesado escribe por WhatsApp y el SuperAdmin crea el local a mano (ADR 0013). El ADR 0007 cerró el registro público porque no había servicio de correo, y sin correo tampoco hay recupero de contraseña. La portada promete 14 días de Pro, pero la base crea la prueba en Básico. El cobro por link (ADR 0052) cobra el plan vigente y el Dueño no puede cambiarlo, así que el fin de la prueba también necesita a una persona.

## Decisión
1. **Registro sin contraseña previa.** `/registro` pide solo el email y manda un enlace (`signInWithOtp`). La contraseña se elige **después** de probar que se controla el correo, en `/crear-local`. Con `enable_signup` encendido, cualquiera puede crear por la API de Auth una cuenta sin confirmar con un email ajeno y una contraseña propia: un trigger en `auth.users` la borra en la misma escritura que confirma el email, así que no hay ningún instante en que esa contraseña valga sobre una cuenta confirmada. Antes de confirmar, Auth no deja entrar con ella.
2. **Google como segunda vía**, con el flujo PKCE desde el servidor (`signInWithOAuth` y `/auth/callback`). Se mantiene «sin cliente de Supabase en el navegador» (ADR 0007). El enlace automático de identidades de Auth quita las identidades sin confirmar de esa cuenta.
3. **El enlace se confirma con un botón.** `/auth/confirmar` muestra una pantalla y `verifyOtp` corre en una *server action*, no en el GET: los antivirus de correo abren los enlaces y gastarían el token, y un enlace ajeno no inicia sesión sin un clic.
4. **El local se crea en un solo paso** por `self_register_organization`, ejecutada solo por `service_role`. Vuelve a exigir un email confirmado en `auth.users`, serializa por cuenta y escribe en una transacción: organización (`origin = 'self_service'`), Pro de prueba por 14 días, Dueño, primera sucursal, reclamo de prueba, aceptación de términos y auditoría. No hay tarjeta ni aprobación manual.
5. **Una prueba por persona.** `trial_claims` guarda un hash del email normalizado (minúsculas, sin `+etiqueta` y sin puntos en Gmail) y sobrevive al borrado de la cuenta y de la organización. Quien ya es Dueño de un local no puede crear otro por esta vía. Un tope global por hora funciona como cortacircuitos; las altas propias se serializan para que no se pueda superar con pedidos simultáneos.
6. **Turnstile lo verifica el servidor de la app**, en `/registro` y `/recuperar`, y **no se enciende el captcha de Auth**: ese captcha también se exige en cada login con contraseña, incluida la reverificación de `changeOwnPassword`, y una caída de Cloudflare dejaría afuera al personal en pleno servicio.
7. **El correo sale por Resend como SMTP de Supabase**, sin dependencia nueva. Las plantillas apuntan a `/auth/confirmar` con `token_hash`.
8. **Recupero de contraseña por correo** (`/recuperar` y `/cuenta/nueva-contrasena`) para todas las cuentas: sin una persona de por medio, es obligatorio.
9. **El Dueño elige plan y ciclo al pagar, solo si no tiene un período pago vigente** (en prueba o vencido). El plan cambia recién al registrarse el pago, dentro de `system_register_mp_payment`. La intención guarda el plan de origen y lo destino: si el SuperAdmin cambió el plan en el medio, o el local ya no entra en el plan elegido, el pago va a revisar y no extiende nada (ADR 0052). Con un período pago vigente solo se renueva el mismo plan. Un local que supera los límites del plan elegido no puede elegirlo: la regla general de «se conserva lo que supera el límite» le daría capacidad de Pro a precio de Básico sin que nadie lo revise. *Confirmado por el usuario el 2026-11-02.*
10. **Las cuentas sin confirmar se purgan a los 7 días** (`purge_unconfirmed_accounts`, solo `service_role`, por lotes). Nunca toca una cuenta con membresía, de SuperAdmin o con reserva vigente (ADR 0032).
11. **SuperAdmin ve el origen** de cada local («Alta propia») y usa las acciones que ya existen para suspender o dar de baja.

## Alternativas consideradas
- **`signUp` con contraseña en el formulario** — es lo habitual, pero una cuenta sin confirmar conserva la primera contraseña: quien la creó con un email ajeno seguiría entrando cuando la víctima confirme.
- **Mantener `enable_signup = false` y crear las cuentas desde el servidor** — conserva la superficie cerrada, pero Auth rechaza entonces las cuentas nuevas de Google.
- **Captcha de Auth** — cubre también la API directa, pero obliga a resolverlo en cada login (decisión 6).
- **Dejar elegir plan en cualquier momento** — con un período pago vigente, pagar Pro sobre un Básico recién pagado regala los días que quedaban. Descartada: lo resuelve el SuperAdmin o se elige al vencer.
- **Aprobar cada local a mano** — evita abusos pero no cumple «automático». El usuario eligió la activación automática con protecciones.

## Consecuencias
- **Enmienda al ADR 0007:** deja de valer «sin registro público». `authenticated` ya no implica «alguien dado de alta por una persona»: una cuenta sin local debe poder lo mismo que `anon`, y hay una prueba de regresión que lo exige.
- **Enlaces por correo:** quien controla un correo puede entrar a esa cuenta sin contraseña, SuperAdmin incluido. Esas cuentas dependen de la seguridad de su casilla.
- **Riesgo residual de la API directa:** como el captcha vive en la app, `/auth/v1/otp` y `/auth/v1/signup` se pueden llamar sin resolverlo. Solo crean cuentas sin confirmar y las limita el tope por IP de Auth y la purga. Quien ocupe un email ajeno puede trabar su alta por el SuperAdmin hasta 7 días.
- **Límites por IP de Auth:** como la app llama desde el servidor, Auth ve una sola IP. Hoy cuentan como un tope global (también para el login). Reenviar la IP real exige una clave `sb_secret` y activar `Sb-Forwarded-For`; queda como mejora.
- **Cartas públicas sin revisión previa:** un local nuevo publica de inmediato. Se reacciona con suspensión o baja, y los términos ya lo permiten.
- **Plan gratuito de Resend:** 100 correos por día. Si se supera, los registros esperan sin enlace y hay que pasar de plan.
- **Terceros nuevos:** Resend, Google y Cloudflare Turnstile tratan datos personales y deben figurar en `/privacidad`, con revisión de un abogado antes de producción.
- **Configuración por entorno fuera de Git:** Auth de cada proyecto (registro, sitio, plantillas, SMTP, Google), `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` y la tarea programada de la purga. Detalle en `docs/produccion.md`.
