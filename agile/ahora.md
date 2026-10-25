# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Reinicios de QR programados y masivos: implementados en local y aprobados por Claude**, nivel C. Rama `main`; implementación `1f82cce`, correcciones `e46a942`. La [ficha](cambios/reinicio-programado-qr.md) concentra aceptación, evidencia, informes y recuperación. El Dueño configura horarios diarios por sucursal en su zona horaria, con 05:00 por defecto; una lista vacía desactiva. Sala → Mesas ofrece a Dueño y Staff reiniciar todas las mesas del local, en todas sus sucursales, con confirmación. El QR impreso y los pedidos se conservan.

La migración nueva `20261204100000` agrega configuración, marcador de servidor, RPC de lectura exclusiva del Dueño, reinicio masivo y trabajo de PostgreSQL cada minuto. Los horarios internos no son públicos. Cambiar horarios, zona o reactivar empieza a contar desde ese momento; tras una interrupción del servicio se recupera el último reinicio pendiente. Los setups de RLS/E2E pausan y restauran el cron solo en Docker local, para aislar las fechas simuladas.

**Staging sigue en Fly v52**, hasta `20261203100000`. La visita en URL ya estaba desplegada: ver la [verificación remota](cambios/turno-de-mesa.md#verificación-remota-de-la-visita-en-la-url-2026-10-25). El nuevo dry-run lista únicamente la migración de este incremento. No se aplicó ni desplegó el cambio nuevo; los commits siguen locales.

## Límites y bloqueos

- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.
- La falla conocida de traducciones, las sugerencias no bloqueantes de Claude y los límites de verificación están en la ficha; no equivalen a defectos del reinicio.
- Si se mata la suite sin teardown, el cron local puede quedar pausado: comprobar `cron.job` o resetear la base local antes del ensayo manual.
- Producción sigue bloqueada por dominio, revisión legal y purgas. Rotar la clave legacy de staging sigue pendiente y fuera del pedido.

## Próximo paso

Con autorización para esta migración nueva y su despliegue, ampliar RLS antes de actualizar staging; aplicar solo el archivo pendiente, desplegar y probar en teléfono real. Las siguientes sugerencias de pruebas no requieren reabrir la implementación aprobada salvo que revelen un defecto.
