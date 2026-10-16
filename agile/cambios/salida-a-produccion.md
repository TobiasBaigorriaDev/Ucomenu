# Cambio: salida a producción — preparación local y estrategia
Estado: preparación local hecha (2026-10-16); el despliegue está **bloqueado por aprobación, decisiones y cuentas**
Nivel: M (el despliegue en sí toca producción, secretos, compras y planes pagos: cada paso remoto lo aprueba el usuario)

## Objetivo
Dejar la salida a producción lista para ejecutar sin improvisar: estrategia decidida (ADR 0015), procedimiento ordenado con sus compuertas de aprobación, propuesta de configuración, respaldos y criterios para subir de plan, y comprobaciones automáticas, sin tocar nada remoto.

## Qué se hizo (todo local)
- **ADR 0015** con la estrategia que fijó el usuario (2026-10-16): Supabase Free con respaldos propios y el mismo proyecto al subir; hosting por decidir (Vercel Hobby descartado, se evalúa Netlify Free); staging gratuito en otra organización de Supabase; monitoreo con registros y Sentry postergado; dominio sin comprar; legal pendiente.
- **`docs/operacion.md`:** entornos y configuración, respaldos (qué, cómo, frecuencia, retención, restauración), seguimiento del consumo con SQL, criterios para subir de plan (Supabase y hosting) y la evaluación de Netlify Free con fuentes y fecha.
- **`docs/produccion.md`:** procedimiento paso a paso, neutral respecto del hosting, con la comprobación obligatoria de la purga antes de publicar.
- **`pnpm respaldo`** (`tools/respaldar.mjs`): esquema, datos (con las cuentas, sin sesiones ni `waiter_calls`) y fotos de Storage, con manifiesto y verificación. Probado contra el Supabase local, incluida una restauración de los datos sobre la misma base.
- **`pnpm prod:check`** (`tools/verificar-produccion.mjs`): revisa la forma de las variables de entorno sin llamar a ningún servicio ni imprimir secretos.

## Hallazgos que cambian decisiones (ver `docs/operacion.md`)
1. **El sondeo de la sala puede agotar el plan Free de Netlify con una sola pantalla** (estimado ~230 a 420 de 300 créditos al mes, sin medir), y agotar los créditos pausa todo el proyecto, la carta pública incluida. Hay cinco opciones para decidir; ninguna implementada.
2. **Un respaldo de `waiter_calls` rompería la promesa de 14 días** de la política de privacidad: se excluye del respaldo.
3. **Ningún plan de Supabase respalda Storage:** el respaldo propio de fotos hace falta también en Pro.
4. **Netlify no documenta `proxy.ts`** (Next.js 16): probar en staging.

## Decisiones (mías, a confirmar)
- Umbrales para subir de plan: 80 % de base, archivos y transferencia; respaldo diario con 7 diarios, 4 semanales y 3 mensuales; ensayo de restauración mensual en staging.
- Netlify Free solo para staging hasta medir; para locales reales, plan pago u otro proveedor combinado con un sondeo más espaciado o limitado al horario del local.
- Monitoreo: ninguna herramienta nueva; verificación de entorno como script aparte y no como chequeo al arrancar (`next start` también corre en modo producción en las pruebas E2E locales).

## Pendiente — necesita al usuario
Elegir hosting (y la opción para el sondeo), comprar el dominio, crear las cuentas y los proyectos (staging primero), cargar variables y claves, primer SuperAdmin, activar `pg_cron`, programar los respaldos y ensayar la restauración en un proyecto nuevo. Más lo previo del legal (ficha `textos-legales.md`).

## Evidencia (2026-10-16, diff sin commitear)
`pnpm lint` · `pnpm typecheck` · `pnpm test` (unitarias, con 27 del verificador de entorno y 12 del respaldo) · `pnpm respaldo --local` real contra el Supabase local, con un archivo de Storage de prueba (borrado después): manifiesto verificado, sin sesiones ni tokens, con `auth.users`, sin `waiter_calls` · restauración de `datos.sql` sobre la base local tras vaciar las tablas: mismos recuentos y mismos hashes de contraseña · `pnpm prod:check --env .env.local` da los 3 errores esperados. **No** probado: nada contra Supabase Cloud, Netlify ni Vercel (no existen cuentas); las cifras de créditos son una estimación con supuestos sin medir.
