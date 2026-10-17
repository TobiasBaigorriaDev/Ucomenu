# Ahora (handoff)

Actualizado: 2026-10-16 · agente saliente: Codex · historial anterior en `agile/historial.md` (consultar solo por un detalle puntual).

## Punto de retomada

- Rama `fix/paginacion-carta-publica`, creada desde `main` en `27b4fb1`. Implementación en `81be3ac`; el commit que incorpora este handoff corrige su cierre y documenta el diagnóstico de compilación. La rama todavía no está integrada ni subida.
- Incremento S cerrado: paginación de categorías y platos de la carta pública. Aceptación, decisiones y evidencia están en [su ficha](cambios/paginacion-carta-publica.md). El tablero lo deja **Hecho**; el usuario aclaró que no requiere revisión independiente.
- **Rigor por consecuencias:** en S alcanza la comprobación afectada y leer el diff. El relevo Codex/Claude no agrega una revisión obligatoria a S; para M se decide según dudas y para C se conserva la revisión independiente y la aprobación humana de lo peligroso. Una tarea por vez.

## Bloqueos y riesgos

- La salida a producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015. Solo el usuario puede crear el proyecto de Supabase de producción, comprar el dominio, elegir el correo de contacto y contratar la revisión legal.
- Staging: `https://ucomenu-staging.fly.dev`; último despliegue informado desde `main`, con migraciones aplicadas. Falta probar con sesión SuperAdmin, sucursales y variantes. La corrección de esta rama queda local.
- Material sensible del ensayo fuera del repo: `C:\Users\tobib\staging.env` y `C:\Users\tobib\respaldos-ucomenu`; limpieza pendiente al terminar el ensayo.
- No imprimir QR hasta tener dominio. Siguen pendientes teléfono real y decisiones de producto de la ficha de variantes. RLS y E2E comparten base y no deben ejecutarse simultáneamente.
- Para compilar desde Codex en Windows, ejecutar fuera del sandbox cuando este deniegue la conexión TCP local de los workers; diagnóstico y evidencia en la ficha de paginación. No queda un bloqueo de compilación abierto.

## Próximo paso

1. Integrar la entrega S local cuando corresponda, sin pedir una revisión adicional. Elegir luego entre los ítems M desbloqueados: buscador y filtros dietarios, disponibilidad por sucursal o identidad del local.
2. Con el usuario: completar las pruebas de staging con sesión, comprobar la primera purga programada y retomar dominio y producción.
