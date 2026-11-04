# Retención de auditoría, cifrado y transferencias
Estado: implementado y verificado en local, revisión independiente aprobada; sin push ni despliegue
Nivel: C (borrado de auditoría y protección/recuperación de copias)

## Objetivo y decisiones
El usuario pidió el 2026-11-04 recomendar y aplicar una solución para los tres pendientes de la revisión legal. Autoriza implementación local; no se firman contratos ni se envían mensajes a proveedores en su nombre.

- Auditoría: mínimo de 10 años desde cada evento, manteniendo los eventos mientras exista la organización o queden pagos/anulaciones asociados. Preserva tanto la precondición de baja del borrado seguro como la identidad de pagos huérfanos (ADR 0027/0028). Purga diaria en lotes solo después de desaparecer ambas dependencias y cumplir el plazo. No se afirma que la ley exija 10 años para todos los eventos.
- Copias: AES-256-GCM, clave aleatoria de 32 bytes separada de la copia, archivo autenticado con versión; no se informa éxito sin verificar descifrado y manifiesto. Sin clave se falla antes de generar SQL. Los temporales en claro solo en un volumen cifrado, fuera del repositorio y de sincronización; se eliminan los temporales creados por esta ejecución, nunca copias anteriores.
- Transferencias: cláusulas modelo AAIP (Resolución 198/2023) responsable/encargado según el rol real, más DPA y control de subencargados. Preparar anexos y matriz por proveedor; no confundir SCC europeas o DPF estadounidense con adecuación argentina. La aceptación de la contraparte debe acreditarse antes de operar con datos reales; no puede simularse con una variable ni con un texto público.

## Aceptación
- [x] Purga conserva eventos recientes y locales existentes, impide ejecución por API y mantiene triggers incluso al fallar.
- [x] Respaldos nuevos salen cifrados por defecto y se recuperan íntegros; clave incorrecta/alteración/truncamiento fallan sin publicar una restauración.
- [x] Privacidad describe la política implementada; queda explícito el límite de contratos aún no instrumentados.
- [x] Matriz y anexos identifican datos, fines, países, rol, subencargados, eliminación y evidencia de firma requerida.

## Invariantes, fallos y recuperación
- No cambiar ACL de lectura de auditoría ni permitir editarla por API. Sin borrado de eventos de menos de 10 años, de locales existentes o con pagos/anulaciones asociados.
- La transacción restaura los triggers ante cualquier excepción; la migración no purga al aplicarse. Pausar cron antes de revertir la función. Borrados ya efectuados requieren respaldo válido.
- No pasar claves por argumentos ni registrarlas. No borrar copias previas o el origen suministrado por el usuario. La pérdida de la clave impide recuperar; conservarla en gestor y copia offline separada, mantener las anteriores tras rotar.
- No extraer un archivo antes de autenticarlo. En un fallo no dejar un destino presentado como copia recuperada.
- Sin publicación de promesas sobre contratos firmados ni cambios remotos.

## Evidencia y revisión
- Migración `20261219100000` creada con CLI (renombrada a la siguiente fecha libre del proyecto), aplicada solo en local con `pnpm db:reset`, seed ficticio. `pnpm db:types` regenerado: sin cambios lógicos de tipos públicos, porque la función es privada. Seed documenta fixtures transaccionales de auditoría.
- RLS `retencion-auditoria` + `acl`: **31/31**; `borrado-de-organizaciones` + `retencion-de-pagos`: **35/35**. `purga-de-price-history`: aprobada en la primera corrida agrupada; esa corrida tuvo un fallo del nuevo test que intentaba borrar sobre una tabla vacía y, por eso, no ejercitaba el trigger. Se corrigió creando una fila ficticia en transacción revertida. Incluye fallo inyectado durante DELETE y recuperación del trigger.
- Unitarias afectadas: **50/50** inicialmente; tras reforzar validación de rutas, `respaldo-cifrado` + `respaldar`: **30/30**. Clave incorrecta, ciphertext/tag/encabezado alterados, truncamiento, rutas de escape, nonce distinto y conservación de origen/destino comprobados.
- Exportación real del Supabase local con clave efímera en memoria: un solo `.aes` final, descifrado, manifiesto verificado y SQL/cuentas recuperados. Storage local vacío; fotos/buckets se cubren con datos sintéticos en unitarias. Primer comprobador esperaba COPY e identificadores sin comillas; se amplió para aceptar COPY o INSERT e identificadores entrecomillados, sin cambiar el producto (que solicita `--use-copy`). No fue una importación completa en otro proyecto ni se accedió a datos reales.
- Build, typecheck y lint aprobados. E2E `legal` + `superadmin-borrado`, contra build y base local: **25/25**. Revisión independiente: pendiente. No se configuró clave permanente, volumen cifrado, tarea de respaldo real o contratos; tampoco se operó en staging/producción. La política describe el comportamiento preparado para publicar, no acredita su activación remota.
- Límites de recuperación por unidad: purga → pausar cron y revertir la función; copias → conservar los `.aes` y claves, usar la herramienta de apertura antes de volver a una versión sin cifrado; contratos → documentación preparatoria, sin efectos externos. No revertir ni descartar el trabajo previo de revisión legal.

## Revisión independiente y correcciones
- Ronda 1 de Claude sobre `e0ca2f4...839dd98`: **aprobar con cambios**; informe `output/revisiones/claude-2625f62d-655f-455d-aaa4-1dea2961b976.md`. Revisión estática, sin ejecutar pruebas ni verificar jurídicamente las fuentes externas.
- Importante 1 confirmado: el límite de lote podía ocultar la falta de la condición de edad, y faltaba comprobar el trigger tras éxito. Corregido con lote amplio y prueba del límite exacto de 10 años, más comprobación del trigger dentro de la transacción después de una purga exitosa.
- Importante 2 confirmado: la auditoría identifica pagos huérfanos según ADR 0027/0028. Se conserva mientras existan pagos o anulaciones; preserva el requisito ya aceptado de trazabilidad, sin aceptar ninguna pérdida nueva de datos contables. Prueba que primero conserva el evento y después permite purgarlo al eliminar el último pago ficticio en transacción revertida.
- Sugerencias atendidas: apertura completa antes de publicar una copia; diagnóstico diferenciado de errores de disco; prueba de `main` que impide volcar SQL sin clave; raíz inexistente y truncamiento intermedio; contrato de contacto vacío explícito y mensaje coherente de `prod:check`; índice ADR y documentación actualizados.
- Corregido además un riesgo previo: el volcado por URL pasaba la contraseña de PostgreSQL por argv. Ahora se quita de la URL y se entrega al hijo por entorno (`SUPABASE_DB_PASSWORD`/`PGPASSWORD`); se omiten diagnósticos del hijo que pudieran contener parámetros sensibles. Unitarias comprueban argv y el ensayo con URL de la misma base local comprueba la CLI instalada, sin conexiones remotas.
- Verificación posterior: **76/76** unitarias afectadas; auditoría+ACL **33/33** RLS; build, tipos y lint correctos; E2E legal+borrado **25/25**. Ensayo repetible incorporado en `tests/integration/respaldo-cifrado.mjs` y ejecutado: exportación, cifrado/apertura real y conexión PostgreSQL por URL con contraseña solo en entorno. No importa el dump en otra base; sigue pendiente el ensayo integral de restauración de producción.
- Intentos de ronda 2 de Claude: sin veredicto por cuota semanal agotada (restablecimiento informado: 13:00 de Argentina); primer intento código 3 de la herramienta y repetición una vez con el mismo resultado. No se interpretó como aprobación ni se cambiaron credenciales.
- Verificación alternativa permitida por AGENTS.md («otro agente o una sesión limpia»): agente `/root/verificar_legal_c`, sin historial, solo lectura, sobre `839dd98..3f786ff`, **APROBAR**, sin bloqueantes ni regresiones. Los ocho hallazgos previos se consideraron corregidos; no ejecutó pruebas ni validó fuentes legales. Informe: `output/revisiones/codex-limpio-3f786ff.md`. Única sugerencia de redacción, atendida: explicitar en privacidad que la dependencia incluye pagos/anulaciones, sin cambio de comportamiento.
