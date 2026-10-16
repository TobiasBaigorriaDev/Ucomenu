# Salida a producción: procedimiento

Procedimiento ordenado para publicar UcoMenu. La estrategia (planes, staging, monitoreo) está decidida en el ADR 0015; los límites, los respaldos y los criterios para subir de plan, en `docs/operacion.md`. Cada paso marca quién lo aprueba. **Nada de esto se ejecutó**: todo lo que toca un servicio remoto, una compra o un dominio necesita aprobación explícita del usuario (`AGENTS.md`, «Límites de autonomía»). Lo único verificable sin salir de la máquina es `pnpm prod:check` y el respaldo local.

El **proveedor de hosting no está decidido** (ADR 0015; Vercel Hobby descartado para uso comercial; se evalúa Netlify). Donde dice «el proveedor de hosting», los pasos valen para cualquiera; el detalle propio de cada uno se agrega al elegirlo.

## 0. Antes de empezar (el usuario)
- **Hosting:** decidirlo después de medir en staging (`docs/operacion.md`, sección 5).
- **Dominio:** `ucomenu.com` **no está comprado**. Comprobar disponibilidad y precio, y definirlo **antes de imprimir los QR definitivos** (cada QR codifica el dominio; no se cambia después sin reimprimir).
- **Legal** (ficha `agile/cambios/textos-legales.md`): revisión profesional de `/terminos`, `/privacidad` y `/alergenos`, identidad del operador y correo real de contacto.
- **Staging primero:** ensayar todo lo siguiente con datos ficticios en un proyecto de Supabase gratuito en **otra organización**, y recién después repetirlo en producción.

## 1. Proyecto de Supabase (aprobación: crea recursos)
1. Crear el proyecto, en Free al comienzo (ADR 0015). Región cercana a los comensales.
2. Aplicar las migraciones con `supabase link` y `supabase db push`. **Nunca** `db reset` ni el `seed.sql` (son datos ficticios y el reset borra todo).
3. Configuración de Auth en el panel de Supabase (el `config.toml` solo vale en local): registro público apagado; contraseña mínima de 10; sin proveedores sociales. Las cuentas las crea el servidor (SuperAdmin y Dueño).
4. Verificar que el bucket `product-images` quedó **público**, con tipos JPEG/PNG/WebP y 2 MB por archivo (ADR 0008; lo crea la migración).
5. Guardar las claves: la **pública** (publishable) y la de **servicio** (secret), y la **conexión directa** a la base (para `pnpm respaldo`).

## 2. Primer SuperAdmin (a mano; aprobación: toca producción)
1. Crear la cuenta en el panel de Auth de Supabase con una contraseña larga. **No** usar las del seed (`admin@ucomenu.test` y similares no existen en producción).
2. Con acceso SQL al proyecto, y nunca desde la app:
   `insert into public.platform_admins (user_id) select id from auth.users where email = '<email>';`
3. Ingresar en `/admin` y crear una organización de ensayo (el alta crea también su primera sucursal).

## 3. Variables de entorno del proveedor de hosting (aprobación: secretos)
Cargarlas en el entorno de producción del proveedor, **no** en Git. Valores distintos en staging y producción:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL https del proyecto (`https://<ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clave pública |
| `SUPABASE_SERVICE_ROLE_KEY` | clave de servicio (solo servidor, jamás `NEXT_PUBLIC_`) |
| `WAITER_CALL_CLIENT_SECRET` | 32 bytes aleatorios en hexadecimal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_SITE_URL` | el dominio definitivo con https, sin ruta |
| `NEXT_PUBLIC_CONTACT_EMAIL` | el correo real de contacto de la política de privacidad |

Las `NEXT_PUBLIC_*` se incrustan **al construir**: cambiarlas exige un nuevo despliegue. `WAITER_CALL_CLIENT_SECRET` también firma el ticket de visita; si se rota, los tickets abiertos dejan de valer (los comensales vuelven a escanear el QR) y cambian los identificadores de cliente.

Antes de desplegar, con las variables copiadas a un archivo **temporal fuera del repositorio**:
```powershell
pnpm prod:check --env C:\ruta\temporal\produccion.env
```
Tiene que dar 0 errores. Borrar el archivo al terminar.

## 4. Programar la purga de `waiter_calls` (aprobación: infraestructura)
La función existe (`public.purge_waiter_calls`, ADR 0014) pero nada la ejecuta, y la política de privacidad **ya promete 14 días**: no publicar sin esto. En el proyecto remoto, activar `pg_cron` (Database → Extensions) y programar una tarea diaria que repite hasta que devuelve menos que el lote, a las 03:00 de Argentina (06:00 UTC):
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
El bloque se probó a mano en la base local como `postgres` (la extensión no está habilitada ahí, así que `cron.schedule` en sí no se ejecutó). Para dar de baja: `select cron.unschedule('purge-waiter-calls');`. El plazo tiene que coincidir con `WAITER_CALL_RETENTION_DAYS` (`src/lib/legal.ts`) y con el texto de privacidad.

**Comprobación obligatoria antes de publicar** (en staging y de nuevo en producción), después de al menos una ejecución real: `cron.job_run_details` con estado `succeeded` y `select count(*) from public.waiter_calls where created_at < now() - interval '14 days'` igual a 0. Para probar con datos ficticios en staging, insertar llamados con `created_at` viejo y ejecutar el bloque a mano.

## 5. Dominio (aprobación: compra y DNS)
1. Comprar el dominio (todavía no está comprado) y agregarlo al proveedor de hosting; apuntar el DNS. Esperar el certificado HTTPS.
2. Confirmar que `NEXT_PUBLIC_SITE_URL` coincide y volver a desplegar si se cambió.
3. Imprimir los QR **después** de este paso: cada QR codifica `{NEXT_PUBLIC_SITE_URL}/t/{token}`.

## 6. Respaldos (antes de cargar datos reales)
Correr `pnpm respaldo` contra el proyecto y **ensayar la restauración en staging** (`docs/operacion.md`, sección 2). Definir quién lo corre y con qué frecuencia. El plan Free no hace respaldos.

## 7. Monitoreo de errores
Inicialmente solo los registros del proveedor de hosting y de Supabase, más la revisión semanal del consumo (`docs/operacion.md`, secciones 3 y 6). Sentry está postergado (ADR 0015).

## 8. Comprobación posterior
Con la app publicada y sin datos reales todavía:
- `/login` ingresa; `/admin` responde 404 a quien no es SuperAdmin.
- El alta de una organización de ensayo crea la sucursal y `/m/{org}/{sucursal}` abre con HTTPS.
- Un QR de mesa abre `/t/{token}`, el llamado llega a la sala y el botón queda en cooldown; el ticket de visita vale desde otra instancia (reabrir tras un nuevo despliegue).
- **El sondeo de la sala:** con una pantalla abierta un rato, anotar el consumo de pedidos y cómputo del proveedor y proyectarlo al mes (`docs/operacion.md`, sección 5); confirmar que `proxy.ts` responde 401 JSON sin sesión en `/sala/{slug}/estado`.
- `/terminos`, `/privacidad` y `/alergenos` abren y el contacto es el real.
- No hay cookies en la carta pública (`/m/...`).
- La purga programada corrió y no quedan llamados de más de 14 días (paso 4).
- Probar en un teléfono real lo pendiente del tablero: ticket de visita con la pantalla apagada y la pantalla «Llamados».

## Marcha atrás
- **Aplicación:** volver al despliegue anterior en el proveedor de hosting.
- **Base:** las migraciones traen su rollback en el encabezado. No se baja una migración en una base con datos reales sin aprobación; la purga de `waiter_calls` es irreversible y no tiene respaldo (aceptado, ADR 0014).
- **Purga mal programada:** `cron.unschedule('purge-waiter-calls')`.
- **Datos perdidos o dañados:** restaurar desde el último respaldo propio (`docs/operacion.md`, sección 2).
