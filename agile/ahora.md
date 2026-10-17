# Ahora (handoff)

Actualizado: 2026-10-16 · agente saliente: Codex · historial anterior en `agile/historial.md` (consultar solo por un detalle puntual).

## Punto de retomada

- Rama `fix/paginacion-carta-publica`, creada desde `main` en `27b4fb1`. La entrega local es el commit que incorpora este handoff; todavía no está integrada ni subida.
- Incremento S implementado: paginación de categorías y platos de la carta pública. Aceptación, decisiones y evidencia están en [su ficha](cambios/paginacion-carta-publica.md). El tablero lo deja **Para verificar** para el relevo acordado.
- **Relevo de roles:** implementa Codex; revisa Claude Code en sesión limpia y solo lectura mediante `agile-revisar`. Una tarea por vez. El próximo agente debe revisar el commit de esta rama, sin incluir nuevamente las funcionalidades ya revisadas en `main`.
- `main` ya incluye variantes y adicionales, SuperAdmin de planes y pagos, sucursales, cierre de sesión por cuenta atendida, alta guiada y rendimiento de carta.

## Bloqueos y riesgos

- La salida a producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015. Solo el usuario puede crear el proyecto de Supabase de producción, comprar el dominio, elegir el correo de contacto y contratar la revisión legal.
- Staging: `https://ucomenu-staging.fly.dev`; último despliegue informado desde `main`, con migraciones aplicadas. Falta probar con sesión SuperAdmin, sucursales y variantes. La corrección de esta rama queda local.
- Material sensible del ensayo fuera del repo: `C:\Users\tobib\staging.env` y `C:\Users\tobib\respaldos-ucomenu`; limpieza pendiente al terminar el ensayo.
- No imprimir QR hasta tener dominio. Siguen pendientes teléfono real y decisiones de producto de la ficha de variantes. RLS y E2E comparten base y no deben ejecutarse simultáneamente.
- La compilación tiene una limitación de entorno documentada en la ficha de paginación; resolverla antes de intentar desplegar esta entrega.

## Próximo paso

1. Claude Code: revisar el commit de esta rama contra la ficha y actualizar su veredicto antes de integrar.
2. Elegir luego entre los ítems M desbloqueados: buscador y filtros dietarios, disponibilidad por sucursal o identidad del local. Los ítems C requieren su flujo correspondiente.
3. Con el usuario: completar las pruebas de staging con sesión, comprobar la primera purga programada y retomar dominio y producción.
