# Reinicio programado y masivo de QR

Estado: implementado y verificado en local; pendiente revisión independiente y aprobación para staging. Nivel **C**: permisos y acceso del comensal a su cuenta. Pedido del usuario, 2026-10-25.

## Alcance y decisiones
- Cada sucursal tiene horarios diarios en su zona horaria actual; valor inicial **05:00** para las existentes y las nuevas. El Dueño puede agregar o quitar horarios, incluido desactivar dejando la lista vacía. Máximo 24 horarios distintos por día, a precisión de minuto.
- Configuración en Panel → Sucursales; recomendación visible de elegir momentos de cierre. Sigue los permisos actuales de edición de sucursales (Dueño y cuenta al día). Horarios legibles solo por RPC del Dueño; el marcador no se lee por la API. Las columnas públicas anteriores de sucursales conservan sus permisos de lectura.
- Sala → Mesas ofrece «Reiniciar todos los QR» a Dueño y Staff, con confirmación explícita: afecta todas las mesas de todas las sucursales de ese local, incluso inactivas. No depende de plan ni mora, igual que el reinicio individual.
- El QR impreso y los pedidos se conservan. Se termina la visita para llamados y cuenta; se vence el pedido de cuenta pendiente como en el reinicio individual.
- Un trabajo `pg_cron` por minuto funciona aunque Fly esté apagado. No reproduce los horarios anteriores a la instalación o a un cambio de configuración. Tras una interrupción, recupera el último horario pendiente y reinicia al ejecutar; la pantalla informa que puede demorarse aproximadamente un minuto en operación normal.

## Invariantes y fallos
- Un miembro nunca reinicia otro local. Solo el Dueño configura; ni anónimos ni service_role acceden al reinicio masivo de personas. El ejecutor automático es privado, sin permisos para roles de API.
- Orden de mesas por sucursal e id, mesa antes del candado de llamados; revalidación de membresía después de las esperas para operaciones manuales. El manual no bloquea sucursales; cron las bloquea `FOR SHARE` (compatible con los llamados) y serializa ejecuciones con un advisory global. Un fallo revierte todo el reinicio masivo.
- Horarios duplicados, segundos, nulos y listas mayores al límite son rechazados por la base. Zona horaria existente, sin cambiar reglas de facturación.
- El marcador evita repetir un horario, incluso en la hora repetida por cambio estacional. Cambiar horarios/zona o activar/desactivar empieza a contar desde el guardado.

## Aceptación
- [x] Por defecto se muestra 05:00; Dueño guarda varios horarios o desactiva y persiste al recargar.
- [x] Staff/ajeno/anónimo no pueden configurar; Staff puede reiniciar todas las mesas de su local, sin tocar otro local, QR ni pedidos.
- [x] Horario local correcto, ejecución repetida sin doble reinicio, recuperación tras interrupción y serialización con llamados/cierre.
- [x] Confirmación manual, estados de espera, error y éxito implementados; confirmación/éxito y ausencia de desborde verificados a 390 px. Error de red no simulado en navegador.

## Recuperación
Desactivar el trabajo con `cron.unschedule('reset-scheduled-table-turns')` y volver al código previo; el reinicio individual sigue disponible. Las visitas terminadas no se restauran: los clientes escanean de nuevo. No elimina datos. Migración y despliegue remotos requieren aprobación específica; este pedido autoriza implementar localmente.

## Evidencia
Sobre `ffe4bb8` + diff de esta ficha (commit de feature identificado en Git), 2026-10-25:
- Migración aplicada mediante `pnpm db:reset` **solo local**, seed actualizado y `pnpm db:types` regenerado. Trabajo activo cada minuto como postgres; ACL comprobada sin EXECUTE para anónimo, authenticated ni service_role en el ejecutor.
- `pnpm test:rls tests/rls/reinicio-programado-qr.rls.test.ts tests/rls/acl.rls.test.ts tests/rls/turno-de-mesa.rls.test.ts`: **61/61** sobre la migración final (12 del cambio). Incluye varios horarios, hora repetida de Nueva York, recuperación, desactivar, privilegios, pertenencia, pedidos/QR conservados, cuenta pendiente vencida sin tocar llamado al mozo, reinicio sin plan y revocación de membresía durante la espera con rollback completo.
- Integración ampliada: `sucursales`, `desactivar-sucursales`, `mesas`, `waiter-calls`, `cuenta-del-comensal`, `pedidos-estados` y `acl`: **146/146**. En esa corrida falló una prueba nueva por envejecer también el llamado al mozo durante la preparación (no era un defecto del reinicio); corregida y cubierta por la corrida final anterior. No se repitieron archivos ajenos al ajuste posterior de locks: la corrida final cubre ambos reinicios y los permisos.
- Regresión de concurrencia: retiene el advisory de un llamado antes de leer su sucursal, mientras reinicia; el llamado confirma y la cuenta queda vencida. **Mutación local** de cron `FOR SHARE` → `FOR NO KEY UPDATE`: la prueba falla por el interbloqueo (el proceso de llamado aborta). Restaurada la función, **1/1** pasa para cron y manual. Logs locales en `output/qr-reset-mutation*.log`; función restaurada.
- Primera corrida de la migración detectó falta de EXECUTE en el validador CHECK para service_role: corregido. Un worker de la prueba nueva cayó con `0xC0000409`; repetido una vez, pasó.
- `pnpm test` completo: **1069/1070**. Única falla preexistente: `src/lib/idiomas/textos.test.ts`, `feed.dockLink` coincide entre español e inglés. Pruebas focalizadas de horarios/sucursales/turno: **31/31**.
- E2E contra build: `reinicio-programado-qr`, `sala-turno`, `ticket-de-visita`, con dos workers: **18/18**. Configurar, recargar, quitar horarios; confirmación/cancelación de reinicio por Staff y pestaña anterior vencida. Inspección visual a 390 px y 1280 px: `output/qr-schedule-{mobile,desktop}.png`, `output/qr-reset-all-mobile.png`, sin desborde. La prueba de conservación de pedidos está en RLS; el E2E masivo verifica QR y visitas.
- `pnpm typecheck`, `pnpm lint` y `pnpm build`: correctos; build final después del ajuste del mensaje de error. `git diff --check`: correcto.
- **No ejecutado:** suite RLS completa, suite E2E completa, teléfono real ni actualización remota. Revisión independiente de Claude: siguiente paso.

## Revisión independiente y correcciones
- Ronda 1, Claude en solo lectura sobre `1f82cce`: **APROBAR CON CAMBIOS**. Informe local `output/revisiones/claude-4774536c-f5e8-499e-a701-ad03d045d110.md`. Hallazgo importante confirmado: el cron real activo competía con las fechas simuladas de las pruebas.
- Corrección: el setup global de RLS y E2E pausa el trabajo **solo en Docker local verificado**, espera ejecuciones pendientes y restaura el estado previo al terminar (también si falla la preparación). La prueba comprueba existencia/programación y que está pausado durante la suite. Tras los 68 casos de corrección se consultó el job: activo de nuevo, cada minuto.
- Sugerencias aplicadas: al reactivar no se recuperan horarios anteriores; se restringió SELECT de los dos campos internos y se agregó `owner_qr_reset_schedules` (solo devuelve horarios del propio local si es Dueño), con lectura paginada en el panel; singular/plural del mensaje masivo y aclaración de mesas inactivas; rollback operativo en la migración.
- Pruebas de las correcciones: `reinicio-programado-qr`, `acl`, `sucursales`, `desactivar-sucursales`: **68/68**, incluida privacidad de columnas y RPC y reactivación. E2E `reinicio-programado-qr`, `sala-turno`, `ticket-de-visita`: **18/18** contra build nuevo; el cron vuelve a estar activo después de la suite. `pnpm typecheck`, `pnpm lint`, `pnpm build` y 31 unitarias focalizadas: correctos. Verificación independiente acotada: siguiente paso.
- Riesgos operativos reconocidos, sin ampliar este incremento: cron procesa locales en una sola transacción; una espera larga puede demorar otros locales y se reintenta en el próximo tick. Revisar `cron.job_run_details` ante retrasos y prever retención de ese registro al operar en producción. La lógica del cierre de turno del ejecutor debe mantenerse alineada con `end_table_turn`; ambos caminos tienen regresión conjunta. La revisión no ejecutó pruebas ni validó Supabase hosted o el borrado de organizaciones.
