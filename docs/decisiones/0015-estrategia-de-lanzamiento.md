# 0015 — Estrategia de lanzamiento: Supabase Free con respaldos propios, hosting en un contenedor de Fly.io, staging aparte

- Estado: aceptada (el hosting lo decidió el agente por delegación del usuario, ver el punto 2)
- Fecha: 2026-10-16 (decisiones del usuario)

## Contexto
El ADR 0001 fijó Next.js en Vercel y Supabase. Al preparar la salida a producción aparecieron tres hechos: (1) el plan Hobby de Vercel no admite uso comercial; (2) el plan gratuito de Supabase no hace respaldos y ningún plan incluye Storage en ellos; (3) el panel de sala consulta el servidor cada 3 s (ADR 0011), lo que pesa distinto según cómo cobre cada hosting. Los datos de planes y límites están en `docs/operacion.md`.

## Decisión
1. **Supabase:** arrancar con el plan **Free**, con respaldos propios (`pnpm respaldo`) y seguimiento semanal del consumo. Al subir de plan se **mantiene el mismo proyecto**.
2. **Hosting:** Vercel Hobby queda descartado para uso comercial. El usuario evaluó Netlify Free y, al ver el costo del sondeo de los llamados cada 3 s, **delegó la elección** en «la forma más eficiente y económica, sin afectar el rendimiento». **Decisión: un contenedor Docker en Fly.io, región São Paulo, una máquina de 512 MB siempre encendida (~USD 6 por mes), con una app aparte para staging.** Corre `next start` sin adaptadores y no cobra por pedido. Se probó la imagen con toda la suite E2E. Detalle, comparación y criterios de cambio en `docs/operacion.md`, sección 5.
3. **Staging:** ensayar el procedimiento con datos ficticios en un proyecto de Supabase **gratuito y aparte**, en una **organización de Supabase distinta**, para que siga gratis cuando producción pase a Pro.
4. **Monitoreo:** al principio, los registros de Fly y de Supabase. **Sentry se posterga.**
5. **Dominio:** `ucomenu.com` **todavía no se compró** (falta ver disponibilidad y precio). Se define antes de imprimir los QR definitivos, porque cada QR codifica el dominio.
6. **Legal:** siguen pendientes la revisión profesional de los textos, la identidad del operador y el correo real. Antes de publicar se comprueba también que la purga programada de `waiter_calls` funciona, porque respalda el plazo de 14 días de la política de privacidad.

## Alternativas consideradas
- **Pro desde el primer día** — da respaldos diarios y evita la pausa, pero cuesta antes de tener ingresos; se prefirió empezar en Free con criterios explícitos para subir (`docs/operacion.md`, sección 4).
- **Staging en la misma organización de Supabase** — más simple, pero cuando producción pase a Pro el staging pagaría su cómputo completo.
- **Vercel Pro** (USD 20 por mes) — la opción más simple y sin operar nada, pero 3 a 4 veces más cara; queda como destino si operar la máquina resulta caro en tiempo.
- **Netlify Free o Pro** — el sondeo de una sola pantalla puede consumir todo el plan gratuito y pausar el proyecto entero; `proxy.ts` sin documentar.
- **Cloudflare Workers (USD 5)** — el más barato, pero OpenNext en Workers no soportaría `proxy.ts` (fuente no oficial) y habría que migrar.
- **Sentry desde el inicio** — dependencia y servicio de terceros que requiere aprobación; los registros alcanzan para un piloto.

## Consecuencias
- **El hosting gratuito con créditos no sirve para locales reales:** la estimación (sin medir) es que una sola pantalla de sala abierta 10 h por día consume entre ~230 y ~420 de los 300 créditos mensuales de Netlify Free, y agotarlos pausa todo el proyecto, carta pública incluida. Por eso se eligió un contenedor de precio fijo.
- **Se opera una máquina:** actualizaciones de seguridad (reconstruir la imagen), un corte de segundos por despliegue con una sola máquina y sin vistas previas por rama. Los criterios para subir de memoria, sumar una máquina o pasar a Vercel Pro están en `docs/operacion.md`.
- Se agregaron `Dockerfile`, `fly.toml` y `fly.staging.toml` (las plantillas de Fly no están validadas: no hay cuenta).
- **Sin respaldos de Supabase mientras sea Free:** la recuperación depende de `pnpm respaldo`. Hay que correrlo y ensayar la restauración; el respaldo es un dato personal (correos y hashes de contraseña) y no incluye `waiter_calls`, para no extender el plazo de 14 días.
- **Enmienda al ADR 0001:** Vercel deja de ser el hosting por defecto y pasa a ser Fly.io (contenedor). Supabase y Next.js se mantienen.
- Nada de lo decidido se ejecutó: crear cuentas y proyectos, comprar el dominio, instalar herramientas y desplegar siguen requiriendo aprobación (`AGENTS.md`).
