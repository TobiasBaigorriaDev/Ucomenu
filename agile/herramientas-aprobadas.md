# Herramientas y skills aprobadas

> Inventario de capacidades externas **aprobadas por el usuario**. Una aprobación aplica a la versión y al alcance indicados; **no** da permiso ilimitado para actualizaciones futuras.

| Herramienta / skill | Fuente (repo/URL) | Versión o commit fijado | Alcance permitido | Fecha | Condiciones / notas |
| --- | --- | --- | --- | --- | --- |
| `pnpm` | https://pnpm.io | 11.19.0 (instalado en la máquina) | Gestor de paquetes de este proyecto: instalar y ejecutar scripts | 2026-10-13 | Versiones de dependencias fijadas por `pnpm-lock.yaml`, que se versiona |
| Dependencias npm del proyecto (Next.js, React, TypeScript, Tailwind, `@supabase/supabase-js`, `@supabase/ssr`, Vitest, Playwright y las que estas requieran) | registro npm | Fijadas en `pnpm-lock.yaml` | Instalarlas en este repo según el stack del ADR 0001 | 2026-10-13 | Una dependencia **fuera** del stack del ADR 0001 requiere nueva aprobación |
| Supabase CLI (`supabase`) | https://github.com/supabase/cli | A fijar al instalar (se registra acá y en `package.json`) | Instalarla como dependencia de desarrollo del proyecto; levantar Supabase **local**, migraciones y generación de tipos | 2026-10-13 | **Solo entorno local.** Vincular un proyecto remoto, `db push` o cualquier operación contra staging/producción requiere aprobación aparte |
| Docker | https://www.docker.com | 29.4.3 (instalado en la máquina) | Contenedores del Supabase local | 2026-10-13 | Sin imágenes de terceros fuera de las que usa la CLI de Supabase |
| Context7 (MCP) | MCP ya conectado en el entorno | Servicio remoto, sin versión fija | Consultar documentación actual de librerías | 2026-10-13 | Solo lectura. No enviar secretos ni datos de clientes en las consultas |
| Playwright (plugin MCP y paquete de pruebas) | MCP ya conectado en el entorno + registro npm | Paquete fijado en `pnpm-lock.yaml` | Pruebas E2E y verificación visual de la app **local** | 2026-10-13 | Navegar solo a `localhost` y a documentación pública; la descarga de navegadores de pruebas queda incluida |
| `frontend-design` (skill de plugin) | Plugin ya instalado en el entorno | La que trae el plugin | Guía de diseño de la carta pública y de las vistas de UcoMenu | 2026-10-13 | Solo orienta el diseño; no ejecuta código propio |

## Checklist antes de aprobar
- [ ] Fuente oficial y autor identificados
- [ ] Mantenimiento reciente y licencia compatible
- [ ] Scripts, dependencias y permisos revisados
- [ ] No requiere secretos ni datos de clientes
- [ ] Versión/commit fijado
- [ ] Alcance por proyecto (preferido) y no global

## Solicitadas pero no disponibles
- `react-best-practices`: el usuario la nombró (2026-10-13), pero **no está instalada** ni aprobada con fuente y versión. Instalarla es un paso aparte (`agile-descubrir-skills`).

## Opcionales mencionados por la metodología (no instalados por defecto)
- Engram (memoria) — ver `memoria/README.md`
- Find Skills / Vercel Skills (https://github.com/vercel-labs/skills) — solo ante una brecha real
- Impeccable (https://impeccable.style) — solo para tareas visuales, previa revisión
