# Ahora (handoff)

Actualizado: 2026-10-16 · agente saliente: Codex · historial anterior en `agile/historial.md` (consultar solo por un detalle puntual).

## Punto de retomada

- Retomada en `main`, con integración local por avance directo de `feat/identidad-local`. Incluye la paginación S cerrada, identidad (`db4ab29`, `a781fc8`) y ajustes menores (`9df251d`). El commit que incorpora este handoff cierra la documentación; sin subir ni desplegar.
- Identidad cerrada: Apariencia del Dueño, logo y paletas cerradas elegidas por el usuario. Revisión comunicada por el usuario sin bloqueantes; tipado y prueba de coherencia CSS ajustados. Aceptación, evidencia y límites de Storage en [su ficha](cambios/identidad-del-local.md). Tablero **Hecho**.
- Prueba manual: servidor `pnpm dev --hostname 127.0.0.1` en puerto 3000 y Supabase local activos. Chrome queda con Apariencia del Café Ejemplo, sesión Dueño de demo iniciada, y carta pública abiertas. Sin reiniciar la base ni cambiar colores o archivos.

## Bloqueos y riesgos

- Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015. Solo el usuario puede crear su proyecto de Supabase, comprar dominio, elegir correo de contacto y contratar revisión legal.
- Staging: `https://ucomenu-staging.fly.dev`; último despliegue informado desde `main`. La migración de identidad se aplicó solo en local; falta probar con sesión SuperAdmin, sucursales y variantes en staging.
- Material sensible del ensayo fuera del repo: `C:\Users\tobib\staging.env` y `C:\Users\tobib\respaldos-ucomenu`; limpieza pendiente.
- No imprimir QR hasta tener dominio. Siguen pendientes teléfono real y decisiones de variantes. RLS y E2E comparten base: no ejecutarlos simultáneamente.
- Compilar en Windows fuera del sandbox cuando deniegue el TCP local de los workers; diagnóstico en la ficha de paginación. No hay bloqueo de compilación pendiente.

## Próximo paso

1. Elegir con el usuario la próxima tarea desbloqueada: buscador/filtros dietarios o disponibilidad por sucursal. Crear su rama desde `main` antes de implementar.
2. El usuario puede seguir probando Apariencia y recargando la carta. Si el servidor se detiene, iniciarlo con `pnpm dev`; Docker debe seguir encendido.
3. Aplicar migraciones remotas y desplegar solo con autorización. Retomar staging, purga, dominio y producción con el usuario.
