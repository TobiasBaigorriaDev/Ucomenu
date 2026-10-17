# Ahora (handoff)

Actualizado: 2026-10-16 · agente saliente: Codex.

## Punto de retomada

Completada la corrección del identificador de una sucursal por SuperAdmin, commit `6a6a0aa` en `feat/correccion-slug-sucursal`, desde `5331d0d`. El tablero la marca **Hecho**. Aunque figuraba S, se aplicó rigor M por migración, panel y resolución de enlaces; no se ampliaron privilegios de clientes ni políticas RLS. No necesita un segundo revisor por defecto.

El SuperAdmin entra a la ficha de una organización y usa «Direcciones de las sucursales». Conserva los identificadores anteriores y permite recuperar uno propio. Dueño y Staff siguen sin editar slug. Los QR no se regeneran. La aceptación, comandos y evidencia están en [la ficha](cambios/correccion-slug-sucursal.md); los motivos duraderos, en ADR 0017. No copiar resultados de pruebas a este handoff.

La migración aditiva se aplicó únicamente en Supabase local y se regeneraron tipos. No hubo reset ni resembrado: se preservó la demo manual y las pruebas usaron organizaciones propias. No se tocaron credenciales, herramientas instaladas ni remotos. El usuario mantiene la preferencia de comandos sin confirmaciones y un solo escritor.

## Bloqueos y riesgos

La rama conserva como base búsqueda y disponibilidad: `ead868e`, `7be826f` y cierre `5331d0d`. **Esos dos incrementos anteriores siguen Para verificar por su revisión independiente C y aprobación humana**, elegidas manualmente por el usuario; esta tarea no los aprueba ni integra. No se invocaron subagentes.

Main continúa en `dc4d102`. No hubo integración, push ni despliegue. La migración de identidad, las de carta y la de históricos todavía esperan ensayo remoto autorizado. Producción continúa bloqueada por dominio, Supabase de producción, contacto y revisión legal: [ficha](cambios/salida-a-produccion.md). RLS y E2E comparten base y deben ejecutarse secuencialmente.

## Próximo paso

Probar la corrección desde SuperAdmin sobre un local de demo, conservando un enlace anterior y su QR para comparar. Después, resolver la revisión pendiente de búsqueda/disponibilidad antes de integrar esta rama que las contiene. Aplicar migraciones remotas o desplegar solo con autorización. Si se abre PR, usar las divisiones de revisión indicadas en las fichas.
