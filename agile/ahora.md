# Ahora (handoff)

Actualizado: 2026-10-16 · agente saliente: Codex · historial anterior en `agile/historial.md` (consultar solo por un detalle puntual).

## Punto de retomada

- Rama `feat/identidad-local`, desde `8b5b782`; incluye la paginación S ya cerrada. Primera unidad en `db4ab29` (persistencia y permisos); segunda unidad en el commit que incorpora este handoff (interfaz, carta y E2E). Sin integrar ni subir.
- Identidad implementada: Apariencia del Dueño, logo y paletas cerradas elegidas por el usuario. Aceptación y evidencia en [su ficha](cambios/identidad-del-local.md). Tablero **Para verificar** por la revisión de permisos, no por comprobaciones técnicas pendientes.
- El ítem M requirió rigor C al agregar políticas de Storage y permisos de columnas. El usuario elige manualmente la sesión revisora; no se invocó otro agente. Para tareas S sigue sin exigirse revisión independiente.

## Bloqueos y riesgos

- Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015. Solo el usuario puede crear su proyecto de Supabase, comprar dominio, elegir correo de contacto y contratar revisión legal.
- Staging: `https://ucomenu-staging.fly.dev`; último despliegue informado desde `main`. La migración de identidad se aplicó solo en local; falta probar con sesión SuperAdmin, sucursales y variantes en staging.
- Material sensible del ensayo fuera del repo: `C:\Users\tobib\staging.env` y `C:\Users\tobib\respaldos-ucomenu`; limpieza pendiente al terminar el ensayo.
- No imprimir QR hasta tener dominio. Siguen pendientes teléfono real y decisiones de variantes. RLS y E2E comparten base: no ejecutarlos simultáneamente.
- Compilar en Windows fuera del sandbox cuando deniegue el TCP local de los workers; diagnóstico en la ficha de paginación. No hay bloqueo de compilación pendiente.

## Próximo paso

1. Revisión independiente y solo lectura de `8b5b782..HEAD` contra la ficha de identidad, enfocada en permisos y recuperación. No repetir la revisión de funcionalidades anteriores.
2. Resolver hallazgos si existen; integrar tras la revisión y aprobación correspondiente. Cualquier aplicación remota requiere autorización del usuario.
3. Luego elegir buscador/filtros dietarios o disponibilidad por sucursal; con el usuario, retomar pruebas de staging, purga, dominio y producción.
