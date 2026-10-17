# Ahora (handoff)

Actualizado: 2026-10-16 · agente saliente: Codex.

## Punto de retomada

El usuario pidió implementar los dos ítems restantes de carta del MVP: buscador con filtros dietarios y disponibilidad por sucursal. Trabajo en `feat/busqueda-y-disponibilidad`, creada desde `main` en `dc4d102`. Búsqueda, etiquetas y detalle están en `ead868e`; disponibilidad y ajustes de integración están en `7be826f`. No se integró a main, subió ni desplegó.

Las dos entregas tienen rigor C técnico por ampliar permisos de columna y agregar una tabla con RLS, aunque el alcance de producto sigue siendo M. El tablero las mantiene en **Para verificar**. El usuario elige manualmente el revisor: no se invocaron otros agentes. La aceptación y evidencia están en las fichas de [búsqueda](cambios/buscador-y-filtros-dietarios.md) y [disponibilidad](cambios/disponibilidad-por-sucursal.md); consultar allí los comandos, resultados y límites de reversión.

Las migraciones aditivas se aplicaron solo en Supabase local y se regeneraron los tipos. No se reseteó ni resembró la base que el usuario tenía abierta para probar identidad; las pruebas nuevas crean sus propios locales. Se conservaron las preferencias de trabajar con comandos sin confirmaciones y un solo escritor. La configuración de acceso completo de Codex venía preparada de la sesión anterior; no se modificó durante esta tarea.

## Bloqueos y riesgos

Falta revisión independiente de los cambios C y aprobación humana antes de integrar sus permisos o aplicarlos en remoto. ADR 0016 describe las decisiones técnicas, todavía como propuesta implementada localmente.

Producción continúa bloqueada por las decisiones del usuario sobre dominio, proyecto de Supabase, contacto y revisión legal: [ficha](cambios/salida-a-produccion.md). Identidad y las nuevas migraciones de carta siguen sin aplicar en staging. No imprimir QR definitivos antes de resolver dominio. RLS y E2E comparten base y deben correr secuencialmente.

## Próximo paso

Entregar esta rama al revisor elegido, usando las fichas y el diff contra `dc4d102`. Corregir solo hallazgos comprobados y actualizar su evidencia. Después de la aprobación, integrar localmente y decidir con el usuario el ensayo remoto. Para probar las funciones, editar un plato en Carta; la carta pública muestra los cambios al recargar.
