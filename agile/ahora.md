# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio y **subida**. Integrado y revisado por Codex: variantes y adicionales, SuperAdmin (plan, suspensión, pagos, prueba), gestión de sucursales, cierre de sesión por cuenta atendida, guía de primeros pasos y rendimiento de la carta.
- **Relevo de roles:** implementa **Codex**; revisa **Claude Code** en sesión limpia y solo lectura (`agile-revisar`). Una tarea por vez. Para nivel C, la revisión de Claude no reemplaza la aprobación del usuario.
- **Salida a producción** (`agile/cambios/salida-a-produccion.md`, «Bloqueado»; ADR 0015). Staging: `https://ucomenu-staging.fly.dev`. Un proyecto de Supabase por entorno, no por cliente.

## Bloqueos y riesgos
- **Solo el usuario puede:** crear el proyecto de Supabase de producción, comprar el dominio, elegir el correo de contacto y contratar la revisión legal. `flyctl` (no `fly`) tiene sesión.
- **Archivos con claves y datos del staging:** `C:\Users\tobib\staging.env` y `C:\Users\tobib\respaldos-ucomenu`; borrarlos al terminar el ensayo.
- **Staging:** las cuatro migraciones recientes (hasta `20261019100000`) están aplicadas (2026-10-17, con respaldo previo). **El código de Fly sigue siendo el anterior:** falta desplegar `main` (pedir aprobación) para ver SuperAdmin de planes, sucursales y variantes.
- **No imprimir QR** hasta tener el dominio. Sin probar en teléfono real.
- RLS y E2E comparten base: no correrlas a la vez. La base local por defecto está reseteada al esquema de `main`.
- Decisiones de producto abiertas en las fichas de variantes y de SuperAdmin (A1–A8 aprobadas).

## Próximo paso
1. **Primera tarea sugerida para Codex (S):** paginar las lecturas de `categories` y `products` de la carta pública (el corte de 1000 filas ya se resolvió para opciones; ver `src/lib/paginar.ts`).
2. **Siguientes (M), por valor:** buscador y filtros dietarios (el modelo `dietary_tags` aún no existe); disponibilidad por sucursal; identidad del local. **C:** desactivar sucursales (reglas ya decididas en su ficha); retención de `price_history` y `payments`.
3. **Al terminar Codex:** commit + ficha con evidencia, actualizar este archivo y pedir a Claude Code revisar el commit.
4. **Con el usuario:** desplegar `main` en staging, ver la primera purga real (`cron.job_run_details`), teléfono real, dominio y producción.
