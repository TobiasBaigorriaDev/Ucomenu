# Cambio: salida a producción — preparación local y estrategia
Estado: preparación local hecha (2026-10-16); el despliegue está **bloqueado por aprobación, decisiones y cuentas**
Nivel: M (el despliegue en sí toca producción, secretos, compras y planes pagos: cada paso remoto lo aprueba el usuario)

## Objetivo
Dejar la salida a producción lista para ejecutar sin improvisar: estrategia decidida (ADR 0015), procedimiento ordenado con sus compuertas de aprobación, propuesta de configuración, respaldos y criterios para subir de plan, y comprobaciones automáticas, sin tocar nada remoto.

## Qué se hizo (todo local)
- **ADR 0015** con la estrategia que fijó el usuario (2026-10-16): Supabase Free con respaldos propios y el mismo proyecto al subir; staging gratuito en otra organización de Supabase; monitoreo con registros y Sentry postergado; dominio sin comprar; legal pendiente. **Hosting:** el usuario delegó la elección («la más eficiente y económica, sin afectar el rendimiento») y se decidió un contenedor en Fly.io, São Paulo (~USD 6 por mes), tras comparar Netlify, Vercel Pro y Cloudflare con precios oficiales.
- **`docs/operacion.md`:** entornos y configuración, respaldos (qué, cómo, frecuencia, retención, restauración), seguimiento del consumo con SQL, criterios para subir de plan (Supabase y hosting) y la decisión de hosting con su comparación de costos, fuentes y fecha.
- **`Dockerfile`, `.dockerignore`, `fly.toml`, `fly.staging.toml`:** imagen de producción (Next.js `standalone` solo con `NEXT_OUTPUT=standalone`; `pnpm build` y `next start` no cambian) y plantillas de Fly. `playwright.config.ts` acepta `E2E_BASE_URL` para probar contra el contenedor.
- **`docs/produccion.md`:** procedimiento paso a paso, neutral respecto del hosting, con la comprobación obligatoria de la purga antes de publicar.
- **`pnpm respaldo`** (`tools/respaldar.mjs`): esquema, datos (con las cuentas, sin sesiones ni `waiter_calls`) y fotos de Storage, con manifiesto y verificación. Probado contra el Supabase local, incluida una restauración de los datos sobre la misma base.
- **`pnpm prod:check`** (`tools/verificar-produccion.mjs`): revisa la forma de las variables de entorno sin llamar a ningún servicio ni imprimir secretos.

## Hallazgos que cambian decisiones (ver `docs/operacion.md`)
1. **El sondeo de la sala puede agotar el plan Free de Netlify con una sola pantalla** (estimado ~230 a 420 de 300 créditos al mes, sin medir), y agotar los créditos pausa todo el proyecto, la carta pública incluida. Por eso se eligió un contenedor de precio fijo, donde el sondeo no cuesta.
2. **Un respaldo de `waiter_calls` rompería la promesa de 14 días** de la política de privacidad: se excluye del respaldo.
3. **Ningún plan de Supabase respalda Storage:** el respaldo propio de fotos hace falta también en Pro.
4. **Netlify no documenta `proxy.ts`** (Next.js 16) y OpenNext en Cloudflare Workers tampoco lo soportaría (sin confirmar); un contenedor lo corre sin adaptadores, y se probó.

## Decisiones (mías, a confirmar)
- Umbrales para subir de plan: 80 % de base, archivos y transferencia; respaldo diario con 7 diarios, 4 semanales y 3 mensuales; ensayo de restauración mensual en staging.
- Hosting: Fly.io (contenedor, `gru`, 512 MB, siempre encendida) por costo fijo, rendimiento y compatibilidad probada; Vercel Pro es el destino de respaldo si operar la máquina sale caro. No se espació el sondeo: el aviso sigue en ≤3 s.
- Monitoreo: ninguna herramienta nueva; verificación de entorno como script aparte y no como chequeo al arrancar (`next start` también corre en modo producción en las pruebas E2E locales).

## Pendiente — necesita al usuario
**Staging y ensayo en un proyecto nuevo hechos** (ver evidencia). Falta: definir y comprar el dominio (pospuesto), repetir todo en producción (proyecto de Supabase en otra organización, `fly.toml`, claves y `WAITER_CALL_CLIENT_SECRET` propios) y programar los respaldos. El ensayo de recuperación se repite manualmente cada mes con el recordatorio elegido por el usuario. Más lo previo del legal (ficha `textos-legales.md`).

## Evidencia (2026-10-16, diff sin commitear)
`pnpm lint` · `pnpm typecheck` · `pnpm test` 320/320 (con 27 del verificador de entorno y 12 del respaldo) · `pnpm build` normal sin cambios · imagen de Docker construida y **toda la suite E2E contra el contenedor: 179 de 179** (una falla por carga en una corrida completa, 9 de 9 al repetir ese archivo); memoria ~80 MB en reposo, ~420 MB de pico, ~200 MB después · `pnpm respaldo --local` real contra el Supabase local, con un archivo de Storage de prueba (borrado después): manifiesto verificado, sin sesiones ni tokens, con `auth.users`, sin `waiter_calls` · restauración de `datos.sql` sobre la base local tras vaciar las tablas: mismos recuentos y mismos hashes de contraseña · `pnpm prod:check --env .env.local` da los 3 errores esperados. **No** probado: nada contra Supabase Cloud ni Fly (no existen cuentas; las plantillas `fly*.toml` no se validaron con `fly`), ni la latencia real desde Argentina; las cifras del costo del sondeo en Netlify y Vercel son una estimación con supuestos sin medir.

## Evidencia del ensayo en staging (2026-10-16)
- **Supabase** (proyecto de staging, plan Free, São Paulo): `db push` aplicó las 15 migraciones; 14 tablas de `public`, **ninguna sin RLS**; `service_role` con SELECT en todas y `anon` sin escritura (se dejaron activadas las tres casillas de creación: la Data API y los permisos por defecto los necesitan las migraciones); bucket `product-images` público; Auth con registro apagado y contraseña mínima 10 (lo hizo el usuario en el panel).
- **Fly:** `flyctl config validate` válido para `fly.toml` y `fly.staging.toml`. App `ucomenu-staging` en `gru`, imagen de 80 MB, una máquina de 512 MB; `/`, `/login`, `/terminos`, `/privacidad`, `/alergenos` responden 200 (0,3 a 1 s), `/admin` redirige al login; secretos cargados con `flyctl secrets import --stage`.
- **Uso real:** primer SuperAdmin por SQL, ingreso, alta de una organización de ensayo, un plato con foto subido a Storage: todo bien (reportado por el usuario).
- **Purga:** `pg_cron` 1.6.4 activado y tarea `purge-waiter-calls` programada a las 06:00 UTC. Prueba con datos ficticios dentro de una transacción deshecha: con lote de 3, 7 llamados de 20 días se borraron y 1 de un día se conservó. **Ejecución real programada vista (2026-10-17, reportada por el usuario):** `cron.job_run_details` con inicio `2026-10-17 06:00:00.214665+00` y estado exitoso; `count(*)` de `waiter_calls` con más de 14 días = 0. Ojo: staging casi no tiene llamados viejos, así que el 0 no prueba por sí solo el borrado; lo prueba la transacción deshecha de arriba. Falta repetir esta comprobación en producción.
- **Respaldo y restauración:** `pnpm respaldo --remoto` (conexión por el Session pooler) con 1 foto: verificado. Se vació el staging (`TRUNCATE` de `public` y `auth.users` con CASCADE) y se cargó `datos.sql` en una sola transacción con `psql` (dentro del contenedor `supabase_db_ucomenu`, por no haber `psql` en Windows); la foto se borró y se volvió a subir con la API de Storage con el mismo SHA-256. Recuentos por tabla idénticos antes y después, cuentas y SuperAdmin presentes, tarea de purga intacta. El usuario confirmó después que ingresa con la misma contraseña y que la carta muestra el plato con su foto.
- **No probado en ese ensayo:** restauración en un proyecto nuevo (ensayada después, abajo), la latencia desde Argentina y todo lo de producción.

## Ensayo de restauración en un proyecto nuevo (2026-10-17)

Autorizado por el usuario al seleccionar la tarea del backlog. Base `3451851`, rama `chore/ensayo-restauracion-y-wake-lock`; staging compartido sin escrituras y producción fuera de alcance.

- Organización comprobada por Management API con plan `free`; creado **`ucomenu-restore-20261017`**, São Paulo, ref `genubsqnytgnokkwyejh`. Destino distinto del origen, vacío antes de importar. Aplicadas **24 migraciones**, sin seed y con directorio de trabajo aislado; el enlace del repositorio sigue apuntando a staging.
- Respaldo remoto existente `2026-10-17T00-40-04Z`, fuera del repositorio: `verificarRespaldo` comprobó tamaños y SHA-256 antes de importar. `datos.sql` cargado por `psql` en el contenedor local, vía Session pooler, en una transacción con `ON_ERROR_STOP=1`.
- Coinciden recuentos de **15 tablas**, incluidas dos cuentas y dos identidades. Hashes de contraseña iguales, sin imprimirlos. **Cero tablas de `public` sin RLS**. Las tablas nuevas de migraciones posteriores al respaldo se conservan.
- Foto de **268978 bytes** recuperada en la misma ruta de `product-images`; descarga posterior con SHA-256 `887696bfcfd9a74c69beae7e302221bb91c3869cb530a5411f7c01c8c784f541`, igual al manifiesto.
- Cuenta restaurada autenticada con un enlace de acceso generado por Admin y verificado por SDK, sin enviar correo ni cambiar contraseña. Auth del destino con registro desactivado y contraseña mínima 10. Secretos nuevos protegidos con DPAPI, fuera de Git.
- App local configurada para el destino nuevo: acceso autenticado a `/panel/cafe-de-ensayo` y carta `/m/cafe-de-ensayo/principal` con **«Foto de Pasta» cargada, ancho natural 341 px**. Capturas `output/playwright/restauracion-panel.png` y `restauracion-carta.png`. No se desplegó una app nueva en Fly.
- Primer intento con `RESTART IDENTITY` falló por `refresh_tokens_id_seq`; la transacción revirtió. Sin esa opción, importación y cotejos pasaron. El primer intento de interfaz heredaba la clave pública local; al configurar `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del destino, pasó. Procedimiento ajustado en `docs/operacion.md`.
- **Recordatorio mensual instalado:** Windows `UcoMenu-Restauracion-Mensual`, listo, próxima ejecución 2026-11-17 a las 18:00 local. XML/acción y `tools/recordar-restauracion.ps1 -DryRun` comprobados; no se mostró un aviso fuera de fecha. No restaura ni crea proyectos automáticamente.

Limpieza confirmada: proyecto de ensayo **`INACTIVE`** (pausado), staging original **`ACTIVE_HEALTHY`** y enlace original conservado. Cookies, certificado HTTPS y servidores temporales eliminados/cerrados; respaldo de origen conservado. No cubre restauración de tareas `pg_cron`, secretos/configuración del proveedor ni producción. No se repitieron suites completas de producto: se ensaya operación, sin cambios de lógica, esquema ni permisos.
