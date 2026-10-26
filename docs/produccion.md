# Salida a producción: procedimiento

Procedimiento ordenado para publicar UcoMenu. La estrategia (planes, hosting, staging, monitoreo) está decidida en el ADR 0015; los límites, los respaldos y los criterios para subir de plan, en `docs/operacion.md`. Cada paso marca quién lo aprueba. **Staging ya se ejecutó (2026-10-16, ficha `agile/cambios/salida-a-produccion.md`); producción no.** Todo lo que toca un servicio remoto, una compra o un dominio necesita aprobación explícita del usuario (`AGENTS.md`, «Límites de autonomía»). Lo único verificable sin salir de la máquina es `pnpm prod:check` y el respaldo local.

El hosting es **un contenedor en Fly.io, región São Paulo** (ADR 0015, `docs/operacion.md` sección 5); la imagen corre igual en cualquier servicio de contenedores. Los comandos de Fly de abajo se ejecutaron y validaron en staging; producción es igual con `fly.toml`.

## 0. Antes de empezar (el usuario)
- **Hosting:** decidido (Fly.io, contenedor en São Paulo). La cuenta y `flyctl` ya existen (staging).
- **Un proyecto de Supabase por entorno, no por cliente:** UcoMenu es multi-inquilino (organizaciones y sucursales en las mismas tablas, aisladas por RLS). Cada negocio nuevo se da de alta desde `/admin`; no se crea ningún proyecto. En total: staging y producción.
- **Dominio:** **`ucomenu.com`, confirmado como definitivo por el usuario (2026-10-26)**; ya es suyo y su DNS está en Cloudflare. Staging no lo necesita: usa la dirección provisoria de Fly (`<app>.fly.dev`). Producción lo usa como `NEXT_PUBLIC_SITE_URL=https://ucomenu.com`; hay que apuntarlo (sección 5) **antes de imprimir los QR definitivos** (cada QR codifica el dominio; no se cambia después sin reimprimir).
- **Legal** (ficha `agile/cambios/textos-legales.md`): revisión profesional de `/terminos`, `/privacidad` y `/alergenos`, identidad del operador y correo real de contacto.
- **Staging primero:** ensayar todo lo siguiente con datos ficticios en un proyecto de Supabase gratuito en **otra organización**, y recién después repetirlo en producción.

## 1. Proyecto de Supabase (aprobación: crea recursos)
1. Crear el proyecto, en Free al comienzo (ADR 0015), en la región de **São Paulo** (la misma ciudad que la app en Fly).
2. Aplicar las migraciones con `supabase link` y `supabase db push`. **Nunca** `db reset` ni el `seed.sql` (son datos ficticios y el reset borra todo).
3. Configuración de Auth en el panel de Supabase (el `config.toml` solo vale en local): registro público apagado; contraseña mínima de 10; sin proveedores sociales. Las cuentas las crea el servidor (SuperAdmin y Dueño).
4. Verificar que el bucket `product-images` quedó **público**, con tipos JPEG/PNG/WebP y 2 MB por archivo (ADR 0008; lo crea la migración).
5. Guardar las claves: la **pública** (publishable) y la de **servicio** (secret), y la **conexión directa** a la base (para `pnpm respaldo`).

## 1b. Staging de Supabase, paso a paso (el usuario; gratis)
Es el ensayo general: mismo procedimiento que producción, con datos ficticios y en otra organización para que siga gratis cuando producción pase a Pro (ADR 0015).

**En el panel (supabase.com/dashboard)**
1. **Organización nueva:** *New organization*, nombre `UcoMenu Staging`, plan **Free**. Tiene que ser distinta de la de producción.
2. **Proyecto nuevo** en esa organización: nombre `ucomenu-staging`, región **South America (São Paulo)**, plan Free. Generar una contraseña de base larga y guardarla en un gestor de contraseñas (no en el repositorio ni en el chat).
3. Cuando termine de crearse, anotar (también fuera del repositorio): la **Reference ID** (Project Settings → General), la **clave pública** (*publishable*) y la **clave secreta** (*secret*) (Project Settings → API Keys) y la URL `https://<ref>.supabase.co`.
4. **Auth** (Authentication): apagar *Allow new users to sign up* y poner la contraseña mínima en 10. No hace falta configurar correo: las cuentas las crea el servidor.

**En tu máquina (desde la carpeta del proyecto)**
```powershell
pnpm exec supabase login                          # abre el navegador, una sola vez
pnpm exec supabase link --project-ref <Reference ID>   # pide la contraseña de la base
pnpm exec supabase db push --dry-run              # muestra qué migraciones aplicaría
pnpm exec supabase db push                        # las aplica al STAGING
```
**Nunca** `db reset` ni `supabase/seed.sql` en un proyecto en la nube: el seed trae cuentas con contraseñas conocidas y el staging es público en internet. El staging se puebla ensayando el procedimiento real: primer SuperAdmin (paso 2) y una organización de ensayo desde `/admin`.

**Comprobar**
- *Database → Migrations* lista todas las migraciones; *Storage* tiene el bucket `product-images`, público.
- El SQL de seguimiento de `docs/operacion.md`, sección 3, corre sin errores.
- Si tu red no tiene IPv6, para `pnpm respaldo` usar la cadena del **Session pooler** (Connect → Session pooler) y no la directa.

## 2. Primer SuperAdmin (a mano; aprobación: toca producción)
1. Crear la cuenta en el panel de Auth de Supabase con una contraseña larga. **No** usar las del seed (`admin@ucomenu.test` y similares no existen en producción).
2. Con acceso SQL al proyecto, y nunca desde la app:
   `insert into public.platform_admins (user_id) select id from auth.users where email = '<email>';`
3. Ingresar en `/admin` y crear una organización de ensayo (el alta crea también su primera sucursal).

## 3. Variables de entorno (aprobación: secretos)
Las públicas (`NEXT_PUBLIC_*`) van como argumentos de construcción de la imagen (`fly deploy --build-arg`); las de servidor, como secretos de Fly (`fly secrets set`). **Nunca en Git ni dentro de la imagen.** Valores distintos en staging y producción:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL https del proyecto (`https://<ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clave pública |
| `SUPABASE_SERVICE_ROLE_KEY` | clave de servicio (solo servidor, jamás `NEXT_PUBLIC_`) |
| `WAITER_CALL_CLIENT_SECRET` | 32 bytes aleatorios en hexadecimal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_SITE_URL` | el dominio definitivo con https, sin ruta |
| `NEXT_PUBLIC_CONTACT_EMAIL` | el correo real de contacto de la política de privacidad |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | *(opcional, ADR 0020)* par de claves del aviso de llamados con la pestaña cerrada: `pnpm push:claves` (un par distinto por entorno). La privada es un **secreto de servidor** (`fly secrets set`); la pública también va como secreto/variable de servidor (la pantalla la lee en tiempo de ejecución). Sin ellas el aviso queda apagado |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | *(opcional; ADR 0046 y 0047)* sugerencia de traducciones y resumen de la analítica con IA. La clave **gratuita** de Gemini sirve solo con datos ficticios (staging): Google puede usar lo enviado para mejorar sus productos. **Antes de producción, con ventas reales, usar un servicio de pago (Claude, por decisión del usuario) y NO cargar la clave gratuita**; sin clave las dos funciones quedan apagadas |
| `VAPID_SUBJECT` | *(opcional)* `mailto:` o `https:` de contacto del aviso; si falta se usa `NEXT_PUBLIC_CONTACT_EMAIL`. Para iPhone/iPad conviene una dirección real y accesible: Apple valida este contacto y puede rechazar los avisos si es inválido |

Las `NEXT_PUBLIC_*` se incrustan **al construir**: cambiarlas exige un nuevo despliegue. `WAITER_CALL_CLIENT_SECRET` también firma el ticket de visita; si se rota, los tickets abiertos dejan de valer (los comensales vuelven a escanear el QR) y cambian los identificadores de cliente (también los `device_key` y `rate_key` de los likes: cada dispositivo puede volver a dar su like una vez; los ya contados quedan).

Antes de desplegar, con las variables (las seis obligatorias y, si se activa el aviso con la pestaña cerrada, las `VAPID_*`) en un archivo **temporal fuera del repositorio**:
```powershell
pnpm prod:check --env C:\ruta\temporal\produccion.env
```
Tiene que dar 0 errores. Borrar el archivo al terminar.

## 3b. Construir, probar y desplegar la imagen (aprobación: cuenta de Fly, instalar `flyctl`, gasto)
**Probar la imagen en local** (no necesita Fly; es lo que se hizo el 2026-10-16: 179 de 179 pruebas E2E):
```powershell
docker build -t ucomenu:probe `
  --build-arg NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:54321 `
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave pública local> `
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3100 `
  --build-arg NEXT_PUBLIC_CONTACT_EMAIL=prueba@example.test .
docker run -d --name ucomenu-probe --add-host host.docker.internal:host-gateway -p 3100:3000 `
  -e SUPABASE_SERVICE_ROLE_KEY=<clave de servicio local> -e WAITER_CALL_CLIENT_SECRET=<el mismo de .env.local> ucomenu:probe
$env:E2E_BASE_URL = "http://localhost:3100"; pnpm exec playwright test
```
`WAITER_CALL_CLIENT_SECRET` tiene que ser el de `.env.local`: las pruebas firman tickets con ese secreto.

**Desplegar a staging primero** (después de crear la app con `fly apps create ucomenu-staging`; el nombre real es único en toda Fly):
```powershell
fly secrets set -c fly.staging.toml SUPABASE_SERVICE_ROLE_KEY=<...> WAITER_CALL_CLIENT_SECRET=<...>
fly deploy -c fly.staging.toml `
  --build-arg NEXT_PUBLIC_SUPABASE_URL=<...> --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<...> `
  --build-arg NEXT_PUBLIC_SITE_URL=<...> --build-arg NEXT_PUBLIC_CONTACT_EMAIL=<...>
```
Producción es igual con `fly.toml`. Revisar con `fly config validate` y `fly status`. Con una sola máquina, cada despliegue tiene unos segundos de corte: hacerlo fuera del horario de servicio.

**Windows con Smart App Control (`flyctl.exe` bloqueado):** `flyctl.exe` no está firmado y Smart App Control lo bloquea («Una directiva de Control de aplicaciones bloqueó este archivo»). No hace falta apagarlo (es irreversible sin reinstalar Windows): se usa la imagen oficial en Docker, con la sesión guardada en un volumen (nunca en el repositorio). Una sola vez:
```bash
docker pull flyio/flyctl:latest
# Login: el comando espera la aprobación en el navegador. Con la entrada abierta, el código que muestra la página se aplica con
# `docker exec <contenedor> /flyctl auth login --code <código>` (en Git Bash, con MSYS_NO_PATHCONV=1). Sin --rm, para copiar
# /.fly (la imagen no define HOME, así que flyctl guarda la configuración en /.fly) a un volumen: ucomenu-fly-config.
```
Cada despliegue (desde la raíz del repositorio, con el árbol confirmado; los `<...>` son los mismos valores públicos de arriba):
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v ucomenu-fly-config:/.fly -v "$(pwd -W):/work" -w /work flyio/flyctl:latest   deploy -c fly.staging.toml --remote-only --build-arg NEXT_PUBLIC_SUPABASE_URL=<...> --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<...>   --build-arg NEXT_PUBLIC_SITE_URL=<...> --build-arg NEXT_PUBLIC_CONTACT_EMAIL=<...>
```
Cualquier otro subcomando (`status`, `releases`, `secrets`) se ejecuta igual cambiando `deploy ...`. Las `NEXT_PUBLIC_*` de staging se pueden reconstruir: la URL sale del `project-ref` de Supabase, la clave pública de `supabase projects api-keys` y el correo de contacto de lo que muestra `/privacidad` desplegado.

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

### 4.b Programar la purga de comentarios del feed (aprobación: infraestructura)
La función `public.purge_video_comments` existe (ADR 0031, enmienda de comentarios; ficha `comentarios-del-feed`) pero nada la ejecuta: sin esto los rechazados (7 días) y los pendientes sin moderar (30 días) se acumulan. **Bloquea habilitar comentarios en producción**, junto con los textos legales. Con `pg_cron` ya activo (paso 4), una tarea diaria a las 03:10 de Argentina (06:10 UTC) que repite hasta que devuelve menos que el lote:
```sql
select cron.schedule(
  'purge-video-comments',
  '10 6 * * *',
  $$
  do $job$
  declare n integer;
  begin
    loop
      n := public.purge_video_comments(interval '7 days', interval '30 days', 5000);
      exit when n < 5000;
    end loop;
  end
  $job$;
  $$
);
```
Los plazos tienen que coincidir con `REJECTED_RETENTION_DAYS` y `PENDING_RETENTION_DAYS` (`src/lib/videos/moderacion.ts`, que la pantalla de moderación muestra) y con el texto de privacidad. Para dar de baja: `select cron.unschedule('purge-video-comments');`. Comprobación después de una ejecución real: `cron.job_run_details` en `succeeded`, `select count(*) from public.video_comments where status = 'rejected' and moderated_at < now() - interval '7 days'` igual a 0, y lo mismo para los pendientes de más de 30 días. El borrado es irreversible y sin respaldo (aceptado: es contenido de un tercero ya descartado).

### 4.c Programar la purga de pedidos (aprobación: infraestructura)
La función `public.purge_expired_orders` existe (ADR 0043; ficha `retencion-de-pedidos`) pero nada la ejecuta: sin esto los pedidos cerrados o anulados se acumulan para siempre. Borra, por lotes, los pedidos **cerrados o anulados hace más de 2 años** con sus líneas, opciones y eventos (nunca uno abierto) y devuelve cuántos borró. **El plazo de 2 años está por confirmar con el contador antes de producción.**

**Un lote por ejecución, no un bucle.** Cada lote apaga un instante la protección de solo-agregado del registro de pedidos y la vuelve a encender, pero el bloqueo de tabla que eso toma dura hasta que termina la transacción: un `DO` con `loop` (una sola transacción) lo mantendría durante TODOS los lotes y haría esperar a quien anota o cambia un pedido, y un error tardío desharía los lotes anteriores. Por eso la tarea corre la función una vez cada pocos minutos, de madrugada: cada ejecución es su propia transacción, de duración corta. Con `pg_cron` activo (paso 4), cada 2 minutos entre las 03:00 y las 05:58 de Argentina (06:00 a 08:58 UTC): 90 lotes de 500 por día, hasta 45 000 pedidos diarios.
```sql
select cron.schedule(
  'purge-expired-orders',
  '*/2 6-8 * * *',
  $$ select public.purge_expired_orders(interval '2 years', 500) $$
);
```
Si el atraso creciera (más de 45 000 pedidos vencidos por día), subir el lote (hasta 5000) o la frecuencia; no convertirlo en un bucle. Para dar de baja: `select cron.unschedule('purge-expired-orders');`. `pg_cron` guarda en `cron.job_run_details` el **estado** de cada ejecución (`succeeded` o `failed`, con el error si falló) pero **no el JSON que devuelve la función**: los conteos de lo borrado (pedidos, líneas, opciones y eventos) no quedan registrados por la tarea. Se ven ejecutando la función a mano (`select public.purge_expired_orders(interval '2 years', 500)` devuelve los conteos del lote) y el estado de la purga se verifica con las consultas de abajo. Comprobación después de una ejecución real: estado `succeeded`, `select count(*) from public.orders where status <> 'open' and closed_at < now() - interval '2 years'` igual a 0 y `select tgenabled from pg_trigger where tgname = 'order_events_no_update_delete'` igual a `O` (encendido). Para probar con datos ficticios en staging: crear un pedido, cerrarlo, envejecer su `closed_at` como `postgres` (con `set session_replication_role = replica`) y ejecutar `select public.purge_expired_orders(interval '2 years', 500)` a mano. **El borrado es irreversible** (solo el respaldo, paso 6).

## 5. Dominio (aprobación: DNS y app de producción)
`ucomenu.com` ya es del usuario (DNS en Cloudflare). Este paso se hace cuando exista la app de producción en Fly (`fly.toml`, hoy plantilla):
1. Agregar el dominio a Fly: `fly certs add ucomenu.com -c fly.toml` (y `www.ucomenu.com` si se quiere; redirigirlo al raíz). `fly certs show ucomenu.com -c fly.toml` indica los registros exactos.
2. En Cloudflare (DNS), crear lo que indique Fly: para el raíz, los registros `A` y `AAAA` con las IP de la app (`fly ips list`), o un `CNAME` al `<app>.fly.dev` (Cloudflare lo aplana en el raíz). Dejar los registros en **«Solo DNS»** (nube gris) hasta que Fly emita el certificado; si después se activa el proxy de Cloudflare, usar cifrado **Full (strict)**.
3. Esperar el certificado HTTPS (`fly certs show`) y confirmar que `NEXT_PUBLIC_SITE_URL=https://ucomenu.com` coincide con lo usado al construir la imagen (se incrusta al construir: si se cambió, volver a desplegar).
4. Imprimir los QR **después** de este paso: cada QR codifica `{NEXT_PUBLIC_SITE_URL}/t/{token}`.
5. Correo de contacto: `NEXT_PUBLIC_CONTACT_EMAIL` tiene que ser una casilla real del dominio (p. ej. con *Email Routing* de Cloudflare reenviando a un correo del usuario); decidir cuál antes de publicar `/privacidad`.

## 6. Respaldos (antes de cargar datos reales)
Correr `pnpm respaldo` contra el proyecto y **ensayar la restauración en staging** (`docs/operacion.md`, sección 2). Definir quién lo corre y con qué frecuencia. El plan Free no hace respaldos.

## 7. Monitoreo de errores
Inicialmente solo los registros de Fly (`fly logs`) y de Supabase, más la revisión semanal del consumo (`docs/operacion.md`, secciones 3 y 6). Sentry está postergado (ADR 0015).

## 8. Comprobación posterior
Con la app publicada y sin datos reales todavía:
- `/login` ingresa; `/admin` responde 404 a quien no es SuperAdmin.
- El alta de una organización de ensayo crea la sucursal y `/m/{org}/{sucursal}` abre con HTTPS.
- Un QR de mesa abre `/t/{token}`, el llamado llega a la sala y el botón queda en cooldown; el ticket de visita vale desde otra instancia (reabrir tras un nuevo despliegue).
- **La máquina:** con una pantalla de sala abierta un rato, anotar la memoria y la CPU de la máquina en el panel de Fly (la imagen midió ~80 MB en reposo; criterios en `docs/operacion.md`, sección 5); confirmar que `/sala/{slug}/estado` responde 401 JSON sin sesión.
- `/terminos`, `/privacidad` y `/alergenos` abren y el contacto es el real.
- No hay cookies en la carta pública (`/m/...`).
- La purga programada corrió y no quedan llamados de más de 14 días (paso 4).
- La purga de comentarios corrió y no quedan rechazados de más de 7 días ni pendientes de más de 30 (paso 4.b).
- La purga de pedidos corrió y no quedan pedidos cerrados o anulados de más de 2 años, con el registro de solo-agregado encendido (paso 4.c).
- Probar en un teléfono real lo pendiente del tablero: ticket de visita con la pantalla apagada y la pantalla «Llamados».

## Marcha atrás
- **Aplicación:** volver a la versión anterior (`fly releases` y `fly deploy --image <imagen anterior>`).
- **Base:** las migraciones traen su rollback en el encabezado. No se baja una migración en una base con datos reales sin aprobación; la purga de `waiter_calls` es irreversible y no tiene respaldo (aceptado, ADR 0014).
- **Purga mal programada:** `cron.unschedule('purge-waiter-calls')`, `cron.unschedule('purge-video-comments')` o `cron.unschedule('purge-expired-orders')`.
- **Datos perdidos o dañados:** restaurar desde el último respaldo propio (`docs/operacion.md`, sección 2).
