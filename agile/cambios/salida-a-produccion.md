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
Crear la cuenta de Fly (tarjeta) e iniciar sesión (`flyctl` v0.4.118 ya está instalado desde 2026-10-16), definir y comprar el dominio (pospuesto), crear las cuentas y los proyectos (staging primero), cargar variables y claves, primer SuperAdmin, activar `pg_cron`, programar los respaldos y ensayar la restauración en un proyecto nuevo. Más lo previo del legal (ficha `textos-legales.md`).

## Evidencia (2026-10-16, diff sin commitear)
`pnpm lint` · `pnpm typecheck` · `pnpm test` 320/320 (con 27 del verificador de entorno y 12 del respaldo) · `pnpm build` normal sin cambios · imagen de Docker construida y **toda la suite E2E contra el contenedor: 179 de 179** (una falla por carga en una corrida completa, 9 de 9 al repetir ese archivo); memoria ~80 MB en reposo, ~420 MB de pico, ~200 MB después · `pnpm respaldo --local` real contra el Supabase local, con un archivo de Storage de prueba (borrado después): manifiesto verificado, sin sesiones ni tokens, con `auth.users`, sin `waiter_calls` · restauración de `datos.sql` sobre la base local tras vaciar las tablas: mismos recuentos y mismos hashes de contraseña · `pnpm prod:check --env .env.local` da los 3 errores esperados. **No** probado: nada contra Supabase Cloud ni Fly (no existen cuentas; las plantillas `fly*.toml` no se validaron con `fly`), ni la latencia real desde Argentina; las cifras del costo del sondeo en Netlify y Vercel son una estimación con supuestos sin medir.
