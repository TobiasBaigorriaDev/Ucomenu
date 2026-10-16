# Operación: configuración, respaldos y criterios para subir de plan

Propuesta concreta para operar UcoMenu al empezar (estrategia del ADR 0015). Es preparación local: **no se creó ninguna cuenta ni proyecto, no se compró nada y no se desplegó nada**. Los pasos para publicar están en `docs/produccion.md`. Los límites y precios de abajo se leyeron en las páginas oficiales el **2026-10-16** y cambian: volver a mirarlos antes de contratar.

## 1. Entornos y configuración

| Entorno | Para qué | Supabase | Hosting | Datos |
| --- | --- | --- | --- | --- |
| Local | Desarrollo y pruebas | Docker (`pnpm db:start`) | `pnpm dev` | Seed ficticio |
| Staging | Ensayar este procedimiento completo | Proyecto **Free** en una **organización de Supabase aparte** | Fly.io, app `fly.staging.toml` (se apaga sin tráfico) | Solo ficticios |
| Producción | Locales reales | Proyecto **Free** al inicio, que sube a **Pro sin crear otro proyecto**, en la región de São Paulo | Fly.io, contenedor en `gru` (sección 5) | Reales |

- **Por qué la organización aparte:** en Pro, cada proyecto adicional de la organización paga su cómputo completo. Con staging en otra organización, producción puede pasar a Pro y staging sigue siendo gratis. Verificar al crearlos que el límite de proyectos gratuitos permite tener ambos.
- **Mismo proyecto al subir de plan:** el cambio Free → Pro es del plan de la organización; la URL, las claves y los datos no cambian. No hace falta migrar nada.
- **Variables:** las seis de `docs/produccion.md` (paso 3), con **valores distintos por entorno**: en especial `WAITER_CALL_CLIENT_SECRET` (no compartirlo entre staging y producción) y `NEXT_PUBLIC_SITE_URL`.
- **Auth** (en el panel de cada proyecto, no viaja en las migraciones): registro público apagado y contraseña mínima de 10.
- **Datos reales nunca en staging** (arquitectura, «Entornos»). Para probar con volumen se usa el seed o datos generados.

## 2. Respaldos propios

**Por qué.** El plan Free de Supabase no hace respaldos automáticos y su documentación recomienda exportar con `db dump` y guardar copias fuera. En Pro hay respaldos diarios de 7 días, pero **ningún plan incluye en ellos los archivos de Storage** (las fotos de `product-images`). Un respaldo propio sirve en los dos planes y también protege de un error humano o de un proyecto pausado/eliminado.

**Cómo: `pnpm respaldo`** (`tools/respaldar.mjs`; probado contra el Supabase local).
```powershell
pnpm respaldo --remoto --env C:\secretos\produccion.env --destino D:\respaldos\ucomenu
```
Crea `D:\respaldos\ucomenu\<fecha>\` con `esquema.sql`, `datos.sql`, `storage\…` y `manifiesto.json`, y al terminar **vuelve a leer todo y verifica** tamaños y SHA-256.
- El archivo de entorno (fuera del repositorio) tiene `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `RESPALDO_DB_URL` (cadena de conexión a la base: la **directa** solo funciona con IPv6, así que sin IPv6 usar la del **Session pooler** del panel de Supabase; la cadena nunca va como argumento).
- Se niega a escribir dentro del repositorio y a mezclar local con remoto. Solo lee.
- **Qué incluye:** estructura, datos de `public` y las cuentas (`auth.users` y `auth.identities`, para que los Dueños conserven su acceso), y las fotos.
- **Qué deja afuera a propósito:** sesiones y tokens de Auth, y **`waiter_calls`**: tiene el identificador derivado de la IP, que la política de privacidad promete borrar a los 14 días; copiarlo a un respaldo de meses rompería esa promesa y son avisos efímeros.
- **El respaldo es un dato personal** (correos y hashes de contraseña): cifrarlo, restringir el acceso y no subirlo a ninguna nube sin cifrar antes. Elegir la herramienta de cifrado es una instalación posiblemente nueva y se aprueba aparte.

**Frecuencia y retención (propuesta).** Una vez por día mientras haya datos reales (pérdida máxima aceptada: 24 h); hasta que haya clientes, una vez por semana. Conservar 7 diarios + 4 semanales + 3 mensuales; borrar el resto. Programarlo (Programador de tareas de Windows u otra máquina siempre encendida) es una decisión de infraestructura que se aprueba aparte. Mientras no esté programado, **el responsable lo corre a mano y lo anota**.

**Restauración: ensayarla.** Un respaldo que nunca se restauró no es un respaldo.
1. Proyecto nuevo (o staging vaciado) con las migraciones aplicadas: `supabase db push`, sin seed.
2. `datos.sql` se carga con `session_replication_role = replica` (ya viene en el archivo) después de vaciar las tablas con datos propios de la migración (`plans`, `addons`) y las de `public` y `auth`: el archivo trae todas.
3. Subir las fotos de `storage\` al bucket `product-images` con la misma ruta (la base guarda solo la ruta).
4. Comprobar: recuento de filas por tabla, ingresar con una cuenta de prueba, abrir una carta con fotos.
- **Ensayo local hecho (2026-10-16):** se vaciaron las tablas y se cargó `datos.sql` sobre la misma base local; volvieron los mismos recuentos y los mismos hashes de contraseña. **No** se probó restaurar en un proyecto nuevo de Supabase: queda pendiente para staging y hay que repetirlo una vez al mes.
- Un proyecto Free pausado se puede reanudar durante un tiempo limitado (la página de pausa dice hasta 1 año; otra referencia habla de 90 días). No contar con eso como respaldo.

## 3. Seguimiento del consumo

Revisión **semanal** (cinco minutos, un responsable) del panel de uso de Supabase y del panel del proveedor de hosting. Anotar la fecha y los números en un lugar del equipo (no en el repositorio). SQL útil en el editor de Supabase:
```sql
-- Tamaño de la base (límite Free: 500 MB)
select pg_size_pretty(pg_database_size(current_database()));
-- Fotos en Storage (límite Free: 1 GB)
select count(*) as archivos, pg_size_pretty(coalesce(sum((metadata->>'size')::bigint), 0)) as peso
from storage.objects where bucket_id = 'product-images';
-- La purga de 14 días funciona: tiene que dar 0 (o muy pocos si justo corre)
select count(*) from public.waiter_calls where created_at < now() - interval '14 days';
-- Última ejecución programada de la purga (requiere pg_cron)
select status, start_time, return_message from cron.job_run_details order by start_time desc limit 5;
```

## 4. Criterios para subir de plan

### Supabase Free → Pro (USD 25 por mes al 2026-10-16)
Límites Free: base de 500 MB, 1 GB de archivos, 5 GB de transferencia por mes, 50 000 usuarios activos, pausa tras 1 semana de inactividad, sin respaldos. Pro: 8 GB de base, 100 GB de archivos, 250 GB de transferencia, sin pausa, respaldos diarios de 7 días (recuperación a un instante: complemento aparte, USD 100 por mes por 7 días).

**Subir a Pro cuando ocurra cualquiera de estas (propuesta, a confirmar con el usuario):**
1. **Uso:** la base pasa de 400 MB, los archivos de 800 MB o la transferencia mensual de 4 GB (80 % del límite), o llega cualquier aviso de límite o de pausa.
2. **Datos que no se pueden perder y un RPO de 24 h ya no alcanza** (por ejemplo, el primer cliente que paga o que pide garantías), o si el respaldo propio falla dos veces seguidas.
3. **Sin tráfico real durante días** y no se acepta la pausa (la pausa de 7 días afecta a staging, pero no debería afectar a un local en uso).
4. **Antes de ampliar** el piloto más allá de los locales conocidos y acompañados (a definir: la propuesta es empezar con pocos).
El sondeo del panel de sala consume transferencia de Supabase: **estimado** ~1 GB por mes por cada pantalla abierta unas 10 h por día (3 consultas por sondeo, 2–3 KB en total). Con 4 pantallas ya se acerca al límite Free. Medirlo en staging.

### Hosting
Los criterios para subir de memoria, sumar una segunda máquina o pasar a otro proveedor están en la sección 5.

## 5. Hosting: decisión (2026-10-16)

**Decisión: un contenedor de Docker en Fly.io, región São Paulo (`gru`), con una máquina de 512 MB siempre encendida para producción y otra app aparte para staging.** El usuario me delegó la elección ("la forma más eficiente y económica, sin que afecte el rendimiento"); es una recomendación mía, reversible porque la imagen corre igual en cualquier servicio de contenedores.

**Por qué.** La app tiene una pantalla que consulta cada 3 s (ADR 0011). Los hostings «serverless» cobran por pedido y por cómputo; un contenedor siempre encendido cobra un precio fijo y el sondeo sale gratis. Además corre `next start` tal cual: `proxy.ts`, las server actions y todo lo demás funcionan sin adaptadores.

### Comparación (USD por mes, leído en las páginas oficiales el 2026-10-16)

| Opción | Costo base | Costo del sondeo de **una** pantalla de sala (estimado) | Rendimiento | Riesgo / trabajo |
| --- | --- | --- | --- | --- |
| Netlify Free | 0 | 230–420 créditos de los 300 mensuales; al agotarse **se pausa todo** | Sin región en América del Sur confirmada | Puede cerrar proyectos gratuitos sin aviso; `proxy.ts` sin documentar. **Descartada** para locales reales |
| Netlify Pro | 20 (3 000 créditos) | Igual en créditos: ~7 a 13 pantallas por mes | Ídem | `proxy.ts` sin documentar |
| Vercel Pro | 20 (incluye 20 de uso) | ~1 a 2 (CPU 0,221/h y memoria 0,0183/GB-h en São Paulo): el crédito alcanza para ~10 pantallas | CDN global y región en São Paulo | Ninguno técnico; **la más simple**, pero 3 a 4 veces más cara |
| Cloudflare Workers (pago) | 5 | Insignificante | Muy bueno (borde) | OpenNext en Workers **no soportaría `proxy.ts`** (fuente no oficial, sin confirmar); habría que migrar. Descartada por ahora |
| **Fly.io, contenedor en `gru`** | **~5,6** (1 CPU compartida, 512 MB) o ~9,6 con 1 GB | **0** (precio fijo; la salida a América del Sur cuesta 0,04 por GB) | Siempre encendida, sin arranque en frío, junto a Supabase en São Paulo | Operar una máquina: imágenes, actualizaciones, sin vistas previas |

Ahorro frente a Vercel Pro: unos USD 14 por mes (USD 170 por año). **Costos sin medir:** el costo del sondeo en Vercel y en Netlify es una estimación (0,3 s por pedido, 15 ms de CPU, 1 GB); el de Fly no depende del sondeo.

### Lo que se probó (local, 2026-10-16)
Se construyó la imagen (`Dockerfile`, Next.js en modo `standalone`, 390 MB, 75 s) y se corrió **toda la suite E2E contra el contenedor**: 179 de 179 pruebas (una falló en una corrida completa por carga y pasó en la repetición, 9 de 9 en su archivo). Eso cubre `proxy.ts` (401 en JSON en la sala, redirección al login), las server actions, la carta pública, el llamado, la sala y el alta de SuperAdmin. Memoria: ~80 MB en reposo, ~420 MB como pico con 11 navegadores en paralelo y ~200 MB al volver al reposo. **No** se probó en Fly (no hay cuenta), ni con la región `gru`, ni con la latencia real.

### Cómo se despliega y qué cuesta operarlo
- `Dockerfile`, `fly.toml` (producción) y `fly.staging.toml` (staging, se apaga sin tráfico). Las plantillas de Fly **no están validadas con `fly`**.
- Una imagen por entorno: las variables `NEXT_PUBLIC_*` se incrustan al construir. Los secretos van con `fly secrets set`, nunca en la imagen.
- Con **una sola máquina**, cada despliegue la reemplaza y hay unos segundos sin servicio; con dos máquinas (el doble de costo) el reemplazo es sin corte. Para el piloto se acepta el corte breve y se despliega fuera del horario de servicio.
- Las actualizaciones de seguridad de Node y de Next.js se reconstruyen a mano (`fly deploy`).
- No hay vistas previas por rama: staging es una app aparte.

### Criterios para cambiar de plan o de proveedor
- **Subir a 1 GB (+USD 4):** memoria sostenida sobre el 80 % o reinicios por falta de memoria.
- **Segunda máquina:** el primer local que no tolere unos segundos de corte en un despliegue, o un incidente de disponibilidad de la máquina.
- **Pasar a Vercel Pro:** si operar la máquina consume más tiempo del que vale el ahorro, si hay dos incidentes de disponibilidad atribuibles a Fly en un trimestre, o si se necesitan vistas previas por rama con más gente en el equipo. La migración es cambiar el destino del despliegue; el código no cambia (lo que cambia es que Vercel no usa el `Dockerfile`).
- **Revisar la decisión** si el sondeo se reemplaza por Realtime o se espacia (ya no importaría el costo por pedido).

Si el sondeo se espaciara (por ejemplo a 5–10 s) o se limitara al horario del local, cualquier hosting por pedido sería más barato; no hace falta para esta decisión y queda como mejora de producto.

## 6. Monitoreo

Solo los registros de Fly (`fly logs`, y el panel de métricas de memoria y CPU) y de Supabase (Logs), más la revisión semanal de la sección 3 (agregar la memoria de la máquina). Sentry u otra herramienta queda **postergada** (ADR 0015). Los registros de Fly no se guardan por mucho tiempo: ante un incidente, mirarlos ese mismo día.

## Fuentes consultadas (2026-10-16)
- Supabase: [precios](https://supabase.com/pricing), [respaldos](https://supabase.com/docs/guides/platform/backups), [pausa de proyectos](https://supabase.com/docs/guides/platform/free-project-pausing).
- Fly.io: [precios](https://fly.io/pricing.md).
- Vercel: [Pro](https://vercel.com/docs/plans/pro-plan), [precios en São Paulo](https://vercel.com/docs/pricing/regional-pricing/gru1), [precios](https://vercel.com/pricing).
- Cloudflare: [precios de Workers](https://developers.cloudflare.com/workers/platform/pricing/).
- Netlify: [precios](https://www.netlify.com/pricing/), [Free vs Pro](https://www.netlify.com/pricing/pro-vs-free.md), [planes por créditos](https://www.netlify.com/changelog/netlify-pricing-update-introducing-credit-based-plans.md), [Next.js 16 en Netlify](https://www.netlify.com/changelog/next-js-16-deploy-on-netlify.md), [Next.js en Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [acuerdo de suscripción](https://www.netlify.com/legal/self-serve-subscription-agreement.md).
