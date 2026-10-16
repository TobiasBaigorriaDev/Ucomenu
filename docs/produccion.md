# Salida a producción: procedimiento

Procedimiento ordenado para publicar UcoMenu (Vercel + Supabase Cloud, ADR 0001). Cada paso marca quién lo aprueba. **Nada de esto se ejecutó**: todo lo que toca un servicio remoto, un pago o un dominio necesita aprobación explícita del usuario (`AGENTS.md`, «Límites de autonomía»). Lo único verificable sin salir de la máquina es `pnpm prod:check`.

Antes de empezar: la revisión legal de `/terminos`, `/privacidad` y `/alergenos` y el responsable que opera el servicio tienen que estar resueltos (ficha `agile/cambios/textos-legales.md`).

## 0. Decisiones y cuentas (el usuario)
- Plan de pago de Supabase y de Vercel (los gratuitos pausan por inactividad: arquitectura, «Límites de los planes gratuitos»).
- Dominio `ucomenu.com`: registro y DNS (producto.md). Un solo dominio para la app; los QR impresos quedan atados a él, así que no se cambia después.
- Entorno de prueba: un proyecto Supabase de staging aparte, con despliegues de vista previa (arquitectura, «Entornos»). Recomendado probar este procedimiento completo ahí antes de producción.

## 1. Proyecto de Supabase (aprobación: crea recursos pagos)
1. Crear el proyecto de producción. Región cercana a los comensales.
2. Aplicar las migraciones al proyecto remoto con `supabase link` y `supabase db push`. **Nunca** `db reset` ni el `seed.sql` (son datos ficticios y el reset borra todo).
3. Configuración de Auth en el panel de Supabase (el `config.toml` solo vale en local):
   - registro público apagado (en local: `enable_signup = false`);
   - contraseña mínima de 10 caracteres (en local: `minimum_password_length = 10`);
   - sin proveedores sociales ni confirmación por email que no se use: las cuentas las crea el servidor (SuperAdmin y Dueño).
4. Verificar que el bucket `product-images` quedó **público**, con tipos JPEG/PNG/WebP y 2 MB por archivo (ADR 0008; lo crea la migración).
5. Guardar las claves: la **pública** (publishable) y la de **servicio** (secret).

## 2. Primer SuperAdmin (a mano; aprobación: toca producción)
1. Crear la cuenta del SuperAdmin en el panel de Auth de Supabase con una contraseña larga. **No** usar las cuentas del seed (`admin@ucomenu.test` y similares no existen en producción).
2. Con acceso SQL al proyecto, y nunca desde la app:
   `insert into public.platform_admins (user_id) select id from auth.users where email = '<email>';`
3. Ingresar en `/admin` y crear la primera organización de prueba con un Dueño real o de ensayo.

## 3. Variables de entorno en Vercel (aprobación: secretos)
Cargarlas en el entorno de producción de Vercel, **no** en Git:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL https del proyecto (`https://<ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clave pública |
| `SUPABASE_SERVICE_ROLE_KEY` | clave de servicio (solo servidor, jamás `NEXT_PUBLIC_`) |
| `WAITER_CALL_CLIENT_SECRET` | 32 bytes aleatorios en hexadecimal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_SITE_URL` | `https://ucomenu.com` (solo el dominio) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | el email real de contacto de la política de privacidad |

Las `NEXT_PUBLIC_*` se incrustan **al construir**: cambiarlas exige un nuevo despliegue. `WAITER_CALL_CLIENT_SECRET` también firma el ticket de visita; si se rota, los tickets abiertos dejan de valer (los comensales vuelven a escanear el QR) y cambian los identificadores de cliente.

Antes de desplegar, con las variables bajadas a un archivo **temporal fuera del repositorio** (por ejemplo con `vercel env pull`):
```powershell
pnpm prod:check --env C:\ruta\temporal\produccion.env
```
Tiene que dar 0 errores. Borrar el archivo al terminar.

## 4. Programar la purga de `waiter_calls` (aprobación: infraestructura de producción)
La función existe (`public.purge_waiter_calls`, ADR 0014) pero nada la ejecuta. En el proyecto remoto, activar la extensión `pg_cron` (Database → Extensions) y programar una tarea diaria que repite hasta que devuelve menos que el lote. Corre a las 03:00 de Argentina (06:00 UTC):
```sql
select cron.schedule(
  'purge-waiter-calls',
  '0 6 * * *',
  $$
  do $job$
  declare n integer;
  begin
    loop
      n := public.purge_waiter_calls(interval '14 days', 5000);
      exit when n < 5000;
    end loop;
  end
  $job$;
  $$
);
```
El bloque se probó a mano en la base local como `postgres` (la extensión no está habilitada ahí, así que `cron.schedule` en sí no se ejecutó). Comprobar al día siguiente en `cron.job_run_details` que el estado es `succeeded`. Para dar de baja: `select cron.unschedule('purge-waiter-calls');`. El plazo (14 días) tiene que coincidir con la constante `WAITER_CALL_RETENTION_DAYS` de `src/lib/legal.ts` y con el texto de privacidad.

## 5. Dominio (aprobación: DNS)
1. Agregar `ucomenu.com` al proyecto de Vercel y apuntar el DNS. Esperar el certificado HTTPS.
2. Confirmar que `NEXT_PUBLIC_SITE_URL` coincide con ese dominio y volver a desplegar si se cambió.
3. Reimprimir los QR **después** de este paso: cada QR codifica `{NEXT_PUBLIC_SITE_URL}/t/{token}`.

## 6. Monitoreo de errores (decisión pendiente)
Lo mínimo sin dependencias nuevas: los logs de Vercel y de Supabase, y mirar el panel de errores del proyecto en los primeros días. Una herramienta de errores (por ejemplo Sentry) es una dependencia y un servicio de terceros: **requiere aprobación** y su propia ficha. Hay que decidir también quién recibe los avisos.

## 7. Comprobación posterior
Con la app publicada, sin datos reales de clientes todavía:
- `/login` ingresa; `/admin` responde 404 a quien no es SuperAdmin.
- El alta de una organización de ensayo crea la sucursal y `/m/{org}/{sucursal}` abre con HTTPS.
- Un QR de mesa abre `/t/{token}`, el llamado llega a la sala y el botón queda en cooldown; el ticket de visita vale desde otra instancia (reabrir tras un nuevo despliegue).
- `/terminos`, `/privacidad` y `/alergenos` abren y el contacto es el real.
- No hay cookies en la carta pública (`/m/...`).
- Probar en un teléfono real lo pendiente del tablero: ticket de visita con la pantalla apagada y la pantalla «Llamados».

## Marcha atrás
- **Aplicación:** volver al despliegue anterior en Vercel.
- **Base:** las migraciones traen su rollback en el encabezado. No se baja una migración en una base con datos reales sin aprobación; la purga de `waiter_calls` es irreversible y no tiene respaldo (aceptado, ADR 0014).
- **Purga mal programada:** `cron.unschedule('purge-waiter-calls')`.
