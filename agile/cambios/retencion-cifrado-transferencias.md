# Retención de auditoría, cifrado y transferencias
Estado: en curso local
Nivel: C (borrado de auditoría y protección/recuperación de copias)

## Objetivo y decisiones
El usuario pidió el 2026-11-04 recomendar y aplicar una solución para los tres pendientes de la revisión legal. Autoriza implementación local; no se firman contratos ni se envían mensajes a proveedores en su nombre.

- Auditoría: mínimo de 10 años desde cada evento, manteniendo los eventos de una organización mientras exista. El historial de baja/reactivación es una precondición del borrado seguro del local: no se elimina su evidencia mientras siga existiendo. Purga diaria en lotes, solo interna, después de ambos requisitos. No se afirma que la ley exija 10 años para todos los eventos.
- Copias: AES-256-GCM, clave aleatoria de 32 bytes separada de la copia, archivo autenticado con versión; no se informa éxito sin verificar descifrado y manifiesto. Sin clave se falla antes de generar SQL. Los temporales en claro solo en un volumen cifrado, fuera del repositorio y de sincronización; se eliminan los temporales creados por esta ejecución, nunca copias anteriores.
- Transferencias: cláusulas modelo AAIP (Resolución 198/2023) responsable/encargado según el rol real, más DPA y control de subencargados. Preparar anexos y matriz por proveedor; no confundir SCC europeas o DPF estadounidense con adecuación argentina. La aceptación de la contraparte debe acreditarse antes de operar con datos reales; no puede simularse con una variable ni con un texto público.

## Aceptación
- [x] Purga conserva eventos recientes y locales existentes, impide ejecución por API y mantiene triggers incluso al fallar.
- [x] Respaldos nuevos salen cifrados por defecto y se recuperan íntegros; clave incorrecta/alteración/truncamiento fallan sin publicar una restauración.
- [x] Privacidad describe la política implementada; queda explícito el límite de contratos aún no instrumentados.
- [x] Matriz y anexos identifican datos, fines, países, rol, subencargados, eliminación y evidencia de firma requerida.

## Invariantes, fallos y recuperación
- No cambiar ACL de lectura de auditoría ni permitir editarla por API. Sin borrado de eventos de menos de 10 años o de locales existentes.
- La transacción restaura los triggers ante cualquier excepción; la migración no purga al aplicarse. Pausar cron antes de revertir la función. Borrados ya efectuados requieren respaldo válido.
- No pasar claves por argumentos ni registrarlas. No borrar copias previas o el origen suministrado por el usuario. La pérdida de la clave impide recuperar; conservarla en gestor y copia offline separada, mantener las anteriores tras rotar.
- No extraer un archivo antes de autenticarlo. En un fallo no dejar un destino presentado como copia recuperada.
- Sin publicación de promesas sobre contratos firmados ni cambios remotos.

## Evidencia y revisión
- Migración `20261219100000` creada con CLI (renombrada a la siguiente fecha libre del proyecto), aplicada solo en local con `pnpm db:reset`, seed ficticio. `pnpm db:types` regenerado: sin cambios lógicos de tipos públicos, porque la función es privada. Seed documenta fixtures transaccionales de auditoría.
- RLS `retencion-auditoria` + `acl`: **31/31**; `borrado-de-organizaciones` + `retencion-de-pagos`: **35/35**. `purga-de-price-history`: aprobada en la primera corrida agrupada; esa corrida tuvo un fallo del nuevo test que intentaba borrar sobre una tabla vacía y, por eso, no ejercitaba el trigger. Se corrigió creando una fila ficticia en transacción revertida. Incluye fallo inyectado durante DELETE y recuperación del trigger.
- Unitarias afectadas: **50/50** inicialmente; tras reforzar validación de rutas, `respaldo-cifrado` + `respaldar`: **30/30**. Clave incorrecta, ciphertext/tag/encabezado alterados, truncamiento, rutas de escape, nonce distinto y conservación de origen/destino comprobados.
- Exportación real del Supabase local con clave efímera en memoria: un solo `.aes` final, descifrado, manifiesto verificado y SQL/cuentas recuperados. Storage local vacío; fotos/buckets se cubren con datos sintéticos en unitarias. Primer comprobador esperaba COPY sin comillas; el dump usa INSERT/identificadores entrecomillados. Se corrigió el comprobador temporal, no el producto, y el ensayo pasó. No fue una importación completa en otro proyecto ni se accedió a datos reales.
- Build, typecheck y lint aprobados. E2E `legal` + `superadmin-borrado`, contra build y base local: **25/25**. Revisión independiente: pendiente. No se configuró clave permanente, volumen cifrado, tarea de respaldo real o contratos; tampoco se operó en staging/producción. La política describe el comportamiento preparado para publicar, no acredita su activación remota.
- Límites de recuperación por unidad: purga → pausar cron y revertir la función; copias → conservar los `.aes` y claves, usar la herramienta de apertura antes de volver a una versión sin cifrado; contratos → documentación preparatoria, sin efectos externos. No revertir ni descartar el trabajo previo de revisión legal.
