# ADR 0054: auditoría, copias cifradas y transferencias internacionales
Estado: aceptado para implementación local · 2026-11-04

El usuario autorizó recomendar y aplicar las tres soluciones pendientes de la revisión legal. El visto bueno profesional ya estaba confirmado; esta decisión concreta las medidas técnicas, sin declarar contratos firmados ni habilitar producción.

## Decisión

**Auditoría:** conservar mientras exista la organización, queden pagos o anulaciones asociados, y al menos 10 años desde cada evento. La baja auditada es una precondición del borrado seguro; además, los ADR 0027/0028 identifican los pagos huérfanos mediante `organization.deleted`. Se preservan ambas defensas existentes. Solo al desaparecer esas dependencias una tarea diaria interna elimina hasta 1000 eventos vencidos. El plazo es una política conservadora de trazabilidad, no una obligación legal universal. Coste: conservación larga de identificadores del actor; se limita el acceso y se informa expresamente. Revisar después la separación entre evidencia contable y operacional si el volumen lo justifica.

**Copias propias:** AES-256-GCM con clave aleatoria de 256 bits, nonce nuevo por copia y autenticación del encabezado. El formato incluye versión y se comprueba descifrando antes de informar éxito. La clave no se guarda dentro del archivo, no se acepta por argumentos y se conserva en un gestor más copia offline separada. No cambiar a una contraseña humana sin una KDF adecuada. Mantener claves anteriores mientras sobrevivan sus copias. La herramienta exige clave incluso para el modo local; no hay salida silenciosa sin cifrar. Los temporales en claro exigen volumen cifrado y no sincronizado; borrarlos no equivale a borrado físico seguro de un SSD. Retención de copias existente: hasta 3 meses; cifrarlas no reemplaza la rotación ni el ensayo integral de restauración.

**Transferencias:** elegir CCM de la AAIP, con el módulo correspondiente al rol real, más DPA y control de subencargados. La [matriz y los anexos](../transferencias-internacionales.md) son el expediente preparatorio. Ni las SCC europeas ni el DPF estadounidense acreditan por sí solos el instrumento argentino. La firma/aceptación de la contraparte sigue pendiente y no se simula en el código; producción con datos reales permanece bloqueada hasta documentarla. No se cambia de proveedor ni de región en este incremento.

## Ejecución y recuperación

Migración nueva sin borrar filas al aplicarse; programa cron a las 07:30 UTC. Nadie de la API, incluido `service_role`, ejecuta la purga. Desactivar la tarea permite detenerla; recuperar filas purgadas exige copia válida. La protección de solo agregado sigue activa y se restituye transaccionalmente ante errores.

Uso de copias y recuperación en [operación del cifrado](../respaldo-cifrado.md). Pruebas, fallos y revisión independiente en [la ficha](../../agile/cambios/retencion-cifrado-transferencias.md).
