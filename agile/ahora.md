# Ahora (handoff)

Actualizado: 2026-10-16 · agente saliente: Codex · historial anterior en `agile/historial.md` (consultar solo por un detalle puntual).

## Punto de retomada

- Rama `feat/identidad-local`, desde `8b5b782`; incluye la paginación S cerrada. Implementación en `db4ab29` y `a781fc8`; el commit que incorpora este handoff atiende las observaciones menores. Sin integrar ni subir.
- Identidad cerrada: Apariencia del Dueño, logo y paletas cerradas elegidas por el usuario. Revisión comunicada por el usuario sin bloqueantes; tipado y prueba de coherencia CSS ajustados. Aceptación, evidencia y límites de Storage en [su ficha](cambios/identidad-del-local.md). Tablero **Hecho**.
- El incremento requirió rigor C por permisos. El ajuste posterior es S y no cambia políticas ni diseño; no requiere otra auditoría. La fuente de la revisión se registra tal como fue recibida, sin atribuirla a un agente no identificado.

## Bloqueos y riesgos

- Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015. Solo el usuario puede crear su proyecto de Supabase, comprar dominio, elegir correo de contacto y contratar revisión legal.
- Staging: `https://ucomenu-staging.fly.dev`; último despliegue informado desde `main`. La migración de identidad se aplicó solo en local; falta probar con sesión SuperAdmin, sucursales y variantes en staging.
- Material sensible del ensayo fuera del repo: `C:\Users\tobib\staging.env` y `C:\Users\tobib\respaldos-ucomenu`; limpieza pendiente al terminar el ensayo.
- No imprimir QR hasta tener dominio. Siguen pendientes teléfono real y decisiones de variantes. RLS y E2E comparten base: no ejecutarlos simultáneamente.
- Compilar en Windows fuera del sandbox cuando deniegue el TCP local de los workers; diagnóstico en la ficha de paginación. No hay bloqueo de compilación pendiente.

## Próximo paso

1. Integrar la rama local cuando corresponda. La revisión comunicada no tiene bloqueantes; los límites aceptados de logos están en la ficha y no implican trabajo pendiente de este incremento.
2. Aplicar migraciones remotas y desplegar solo con autorización del usuario. No se modificó staging ni producción en esta sesión.
3. Luego elegir buscador/filtros dietarios o disponibilidad por sucursal; con el usuario, retomar pruebas de staging, purga, dominio y producción.
