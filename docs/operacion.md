# Operación: configuración, respaldos y criterios para subir de plan

Propuesta concreta para operar UcoMenu al empezar (estrategia del ADR 0015). Es preparación local: **no se creó ninguna cuenta ni proyecto, no se compró nada y no se desplegó nada**. Los pasos para publicar están en `docs/produccion.md`. Los límites y precios de abajo se leyeron en las páginas oficiales el **2026-10-16** y cambian: volver a mirarlos antes de contratar.

## 1. Entornos y configuración

| Entorno | Para qué | Supabase | Hosting | Datos |
| --- | --- | --- | --- | --- |
| Local | Desarrollo y pruebas | Docker (`pnpm db:start`) | `pnpm dev` | Seed ficticio |
| Staging | Ensayar este procedimiento completo | Proyecto **Free** en una **organización de Supabase aparte** | Proveedor candidato, plan gratuito | Solo ficticios |
| Producción | Locales reales | Proyecto **Free** al inicio, que sube a **Pro sin crear otro proyecto** | Por decidir (sección 5) | Reales |

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
- El archivo de entorno (fuera del repositorio) tiene `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `RESPALDO_DB_URL` (conexión **directa** a la base; la cadena nunca va como argumento).
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

### Hosting (candidato: Netlify Free) → plan pago u otro proveedor
Ver la evaluación en la sección 5. **Subir o cambiar** si cualquiera:
1. La proyección mensual de créditos supera el 70 % del plan en la revisión semanal (mirar la proyección, no solo lo gastado).
2. Un local real depende del servicio en horario de atención: el plan Free puede **dar de baja proyectos sin aviso** y no tiene garantías de servicio.
3. Se agotan los créditos: el proyecto entero **se pausa hasta el próximo ciclo**, incluida la carta pública que ven los comensales.

## 5. Evaluación del hosting: Netlify Free (2026-10-16)

**Lo que se verificó**
- **Next.js:** Netlify anuncia soporte de Next.js 16 sin configuración (adaptador de OpenNext, probado en cada versión). La documentación consultada **no menciona `proxy.ts`** (el archivo que en Next 16 reemplaza a `middleware.ts`) y UcoMenu depende de él para renovar la sesión y responder 401 a la sala. **Hay que probarlo en staging antes de decidir.**
- **Uso comercial:** ni los Términos de uso ni el Acuerdo de suscripción de autoservicio (cuyo texto es de 2020) prohíben el uso comercial del plan gratuito, y el anuncio del plan lo permite. Pero el acuerdo se reserva el derecho de **cerrar proyectos gratuitos sin aviso y por cualquier motivo**, no da garantías de servicio y el plan «está pensado para desarrolladores individuales». Es **viable para staging y para un piloto**, no para un local que dependa de la carta en horario de servicio.
- **Créditos:** el plan Free tiene **300 créditos por mes** sin recarga; al agotarse, **los proyectos se pausan hasta el próximo ciclo**. Costos según el aviso oficial de precios: 15 créditos por despliegue a producción, 10 por GB transferido, 5 por GB-hora de cómputo y 3 por 10 000 pedidos web. (La página de precios muestra cifras algo distintas —20, 10 y 2— así que hay que confirmarlas en el panel.) Plan Pro: USD 20 por mes con 3 000 créditos.

**El problema: el sondeo de la sala.** `GET /sala/{slug}/estado` se consulta cada 3 s con la pestaña visible (ADR 0011). Estimación para **una** pantalla abierta 10 h por día durante 30 días:

| Concepto | Cuenta | Créditos al mes |
| --- | --- | --- |
| Pedidos | 1 200 por hora × 10 h × 30 = 360 000 → 36 bloques de 10 000 | ~72 a 108 |
| Cómputo | 360 000 × ~0,3 s (3 consultas a Supabase) × 1 GB ≈ 30 GB-h | ~150 a 300 |
| Transferencia | 360 000 × ~1,5 KB ≈ 0,5 GB | ~5 a 11 |
| **Total por pantalla** | | **~230 a 420** |

Es **más que todo el plan Free (300)** con una sola pantalla, y el pedido pasa por `proxy.ts`, que podría sumar. Los supuestos (0,3 s por pedido, 1 GB de memoria, tamaño de respuesta) **no se midieron**: medirlos en staging con una pantalla real. El efecto de agotar los créditos es grave: se pausa **todo**, no solo la sala.

**Opciones para decidir (ninguna implementada)**
1. **Espaciar el sondeo** a 5–10 s: el costo baja casi en proporción (a 10 s, ~70 a 125 créditos por pantalla). Cuesta latencia en el aviso (hoy ≤3 s). Es un cambio de producto: decide el usuario.
2. **Sondear solo en el horario del local** (la pantalla deja de consultar fuera de él).
3. **Recortar el trabajo por pedido** (hoy valida el usuario contra Auth, lee las membresías y lee la sala: tres idas a Supabase).
4. **Supabase Realtime** en lugar de sondeo (reabre la enmienda al ADR 0007 sobre el token en el navegador; ADR 0011 lo dejó como alternativa).
5. **Otro proveedor o plan pago** cuya tarifa no cobre por pedido. Candidatos a evaluar, **sin verificar**: Netlify Pro (USD 20 por mes, 3 000 créditos), Vercel Pro (Hobby está descartado para uso comercial), Cloudflare.

**Recomendación:** usar Netlify Free solo para **staging**, medir el costo real de una pantalla de sala y decidir ahí. Para producción con locales reales no confiar en un plan gratuito de hosting con créditos: combinar la opción 1 o 2 con un plan pago, o elegir otro proveedor. Es una recomendación, no una decisión tomada.

## 6. Monitoreo

Solo los registros del proveedor de hosting y de Supabase (Logs), más la revisión semanal de la sección 3. Sentry u otra herramienta queda **postergada** (ADR 0015). Observación: el plan Free de Netlify guarda 1 día de métricas de observabilidad: si hay un incidente, mirar los registros ese mismo día.

## Fuentes consultadas (2026-10-16)
- Supabase: [precios](https://supabase.com/pricing), [respaldos](https://supabase.com/docs/guides/platform/backups), [pausa de proyectos](https://supabase.com/docs/guides/platform/free-project-pausing).
- Netlify: [precios](https://www.netlify.com/pricing/), [Free vs Pro](https://www.netlify.com/pricing/pro-vs-free.md), [planes por créditos](https://www.netlify.com/changelog/netlify-pricing-update-introducing-credit-based-plans.md), [Next.js 16 en Netlify](https://www.netlify.com/changelog/next-js-16-deploy-on-netlify.md), [Next.js en Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [acuerdo de suscripción](https://www.netlify.com/legal/self-serve-subscription-agreement.md).
