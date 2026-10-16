# Cambio: salida a producción — preparación local
Estado: parte local hecha (2026-10-16); el despliegue está **bloqueado por aprobación y cuentas**
Nivel: M (el despliegue en sí toca producción, secretos y planes pagos: cada paso remoto lo aprueba el usuario)

## Objetivo
Dejar la salida a producción lista para ejecutar sin improvisar: un procedimiento ordenado con sus compuertas de aprobación y una comprobación automática del entorno, sin tocar nada remoto.

## Qué se hizo (todo local)
- `docs/produccion.md`: procedimiento paso a paso (proyecto Supabase, migraciones con `db push` y nunca `reset`, configuración de Auth, primer SuperAdmin, variables de Vercel, purga con `pg_cron`, dominio, monitoreo, comprobación posterior y marcha atrás). Cada paso dice quién aprueba.
- `pnpm prod:check [--env archivo]` (`tools/verificar-produccion.mjs`): revisa la **forma** de las variables sin llamar a ningún servicio ni imprimir secretos. Errores si falta o es local `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SITE_URL`, si la clave pública es de servicio, si la de servicio falta o viaja en una variable `NEXT_PUBLIC_*`, si `WAITER_CALL_CLIENT_SECRET` falta o tiene menos de 16 caracteres, o si falta el email de contacto.
- La tarea de purga diaria quedó escrita (bucle hasta que devuelve menos que el lote, 03:00 de Argentina) y el bloque SQL se ejecutó en la base local.

## Decisiones (mías)
- El procedimiento vive en `docs/produccion.md`, no en esta ficha ni en el tablero (una función por documento).
- Monitoreo: no se agrega ninguna herramienta; Sentry u otra es una dependencia de terceros y queda como decisión del usuario.
- La verificación de entorno es un script aparte y no un chequeo al arrancar la app: `next start` corre en modo producción también en las pruebas E2E locales, así que un chequeo duro rompería esas pruebas.

## Pendiente — necesita al usuario
Todo lo de `docs/produccion.md` desde el paso 0: plan pago de Supabase y Vercel, dominio y DNS, crear el proyecto, aplicar migraciones, cargar variables y claves, primer SuperAdmin, activar `pg_cron`, decidir el monitoreo. Más lo previo: revisión legal y responsable (ficha de textos legales). Recomendado ensayar todo en un proyecto de staging.

## Evidencia (2026-10-16, diff sin commitear)
`pnpm test tests/unit/verificar-produccion` 26/26 (forma de cada variable, no filtra secretos, códigos de salida 0/1/2 por línea de comandos) · `pnpm prod:check --env .env.local` sobre el entorno local da 3 errores esperados (Supabase local, sin dirección pública, sin contacto). Sin probar contra Vercel ni Supabase Cloud: no existen.
