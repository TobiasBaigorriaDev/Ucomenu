# 0015 — Estrategia de lanzamiento: Supabase Free con respaldos propios, hosting por decidir, staging aparte

- Estado: aceptada, salvo el hosting (pendiente de evaluar)
- Fecha: 2026-10-16 (decisiones del usuario)

## Contexto
El ADR 0001 fijó Next.js en Vercel y Supabase. Al preparar la salida a producción aparecieron tres hechos: (1) el plan Hobby de Vercel no admite uso comercial; (2) el plan gratuito de Supabase no hace respaldos y ningún plan incluye Storage en ellos; (3) el panel de sala consulta el servidor cada 3 s (ADR 0011), lo que pesa distinto según cómo cobre cada hosting. Los datos de planes y límites están en `docs/operacion.md`.

## Decisión
1. **Supabase:** arrancar con el plan **Free**, con respaldos propios (`pnpm respaldo`) y seguimiento semanal del consumo. Al subir de plan se **mantiene el mismo proyecto**.
2. **Hosting:** **no está decidido.** Vercel Hobby queda descartado para uso comercial. Se evalúa Netlify Free: hay que verificar la compatibilidad con la versión de Next.js y estimar el consumo, sobre todo por el sondeo de los llamados cada 3 s.
3. **Staging:** ensayar el procedimiento con datos ficticios en un proyecto de Supabase **gratuito y aparte**, en una **organización de Supabase distinta**, para que siga gratis cuando producción pase a Pro.
4. **Monitoreo:** al principio, los registros del proveedor de hosting y de Supabase. **Sentry se posterga.**
5. **Dominio:** `ucomenu.com` **todavía no se compró** (falta ver disponibilidad y precio). Se define antes de imprimir los QR definitivos, porque cada QR codifica el dominio.
6. **Legal:** siguen pendientes la revisión profesional de los textos, la identidad del operador y el correo real. Antes de publicar se comprueba también que la purga programada de `waiter_calls` funciona, porque respalda el plazo de 14 días de la política de privacidad.

## Alternativas consideradas
- **Pro desde el primer día** — da respaldos diarios y evita la pausa, pero cuesta antes de tener ingresos; se prefirió empezar en Free con criterios explícitos para subir (`docs/operacion.md`, sección 4).
- **Staging en la misma organización de Supabase** — más simple, pero cuando producción pase a Pro el staging pagaría su cómputo completo.
- **Vercel Pro desde el inicio** — resuelve el uso comercial; no se eligió todavía porque se quiere comparar costo y consumo antes de fijar el proveedor.
- **Sentry desde el inicio** — dependencia y servicio de terceros que requiere aprobación; los registros alcanzan para un piloto.

## Consecuencias
- **El hosting gratuito con créditos tiene un riesgo concreto:** la estimación (sin medir) es que una sola pantalla de sala abierta 10 h por día consume entre ~230 y ~420 de los 300 créditos mensuales de Netlify Free, y agotarlos pausa todo el proyecto, carta pública incluida. Se resuelve con una de las opciones de `docs/operacion.md` (sección 5) antes de poner un local real; decide el usuario. Netlify Free queda, por ahora, como candidato **solo para staging**.
- **Sin respaldos de Supabase mientras sea Free:** la recuperación depende de `pnpm respaldo`. Hay que correrlo y ensayar la restauración; el respaldo es un dato personal (correos y hashes de contraseña) y no incluye `waiter_calls`, para no extender el plazo de 14 días.
- **Enmienda al ADR 0001:** Vercel deja de ser el hosting por defecto; la decisión de proveedor se cierra en una ADR posterior. Supabase se mantiene.
- Nada de lo decidido se ejecutó: crear cuentas y proyectos, comprar el dominio, instalar herramientas y desplegar siguen requiriendo aprobación (`AGENTS.md`).
