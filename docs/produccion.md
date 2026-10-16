# Salida a producción: procedimiento

Procedimiento ordenado para publicar UcoMenu. La estrategia (planes, hosting, staging, monitoreo) está decidida en el ADR 0015; los límites, los respaldos y los criterios para subir de plan, en `docs/operacion.md`. Cada paso marca quién lo aprueba. **Staging ya se ejecutó (2026-10-16, ficha `agile/cambios/salida-a-produccion.md`); producción no.** Todo lo que toca un servicio remoto, una compra o un dominio necesita aprobación explícita del usuario (`AGENTS.md`, «Límites de autonomía»). Lo único verificable sin salir de la máquina es `pnpm prod:check` y el respaldo local.

El hosting es **un contenedor en Fly.io, región São Paulo** (ADR 0015, `docs/operacion.md` sección 5); la imagen corre igual en cualquier servicio de contenedores. Los comandos de Fly de abajo se ejecutaron y validaron en staging; producción es igual con `fly.toml`.

## 0. Antes de empezar (el usuario)
- **Hosting:** decidido (Fly.io, contenedor en São Paulo). Falta aprobar crear la cuenta y la tarjeta, e instalar `flyctl` (herramienta nueva: requiere aprobación).
- **Dominio:** **pospuesto** (2026-10-16: el usuario no está seguro de `ucomenu.com`; está en el backlog). Staging no lo necesita: usa la dirección provisoria de Fly (`<app>.fly.dev`). Producción sí: hay que definirlo **antes de imprimir los QR definitivos** (cada QR codifica el dominio; no se cambia después sin reimprimir).
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

Las `NEXT_PUBLIC_*` se incrustan **al construir**: cambiarlas exige un nuevo despliegue. `WAITER_CALL_CLIENT_SECRET` también firma el ticket de visita; si se rota, los tickets abiertos dejan de valer (los comensales vuelven a escanear el QR) y cambian los identificadores de cliente.

Antes de desplegar, con las seis variables en un archivo **temporal fuera del repositorio**:
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
1. Con el dominio ya elegido y comprado (pospuesto), agregarlo a Fly (`fly certs add <dominio>`); apuntar el DNS como indique Fly. Esperar el certificado HTTPS (`fly certs show <dominio>`).
2. Confirmar que `NEXT_PUBLIC_SITE_URL` coincide y volver a desplegar si se cambió.
3. Imprimir los QR **después** de este paso: cada QR codifica `{NEXT_PUBLIC_SITE_URL}/t/{token}`.

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
- Probar en un teléfono real lo pendiente del tablero: ticket de visita con la pantalla apagada y la pantalla «Llamados».

## Marcha atrás
- **Aplicación:** volver a la versión anterior (`fly releases` y `fly deploy --image <imagen anterior>`).
- **Base:** las migraciones traen su rollback en el encabezado. No se baja una migración en una base con datos reales sin aprobación; la purga de `waiter_calls` es irreversible y no tiene respaldo (aceptado, ADR 0014).
- **Purga mal programada:** `cron.unschedule('purge-waiter-calls')`.
- **Datos perdidos o dañados:** restaurar desde el último respaldo propio (`docs/operacion.md`, sección 2).
