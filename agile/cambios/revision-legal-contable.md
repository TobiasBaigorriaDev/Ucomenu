# Revisión legal y contable previa a producción
Estado: verificado e integrado en commits locales, sin despliegue; continuación en la ficha C
Nivel: M (textos, contacto público y trazabilidad de aceptación; no cambia cobros, permisos, esquema ni purgas)

## Objetivo y autorización
El usuario confirmó el 2026-11-04 que abogado y contador dieron el visto bueno y autorizó revisar y corregir el código legal/contable. Proporcionó los datos del responsable y su contacto para publicarlos en los textos. Se toma su confirmación para los plazos existentes de pedidos (2 años) y pagos (10 años); no se presume un plazo de auditoría ni contratos o cifrado ya instrumentados.

## Alcance y hallazgos
Revisión estática sobre `e0ca2f4` más este diff: tres páginas legales, componentes y configuración legal, versión del registro, cliente de Mercado Pago, respaldo, migraciones de retención y guía de producción. No es una auditoría integral de permisos ni un dictamen fiscal.

1. **Importante, corregido:** privacidad omitía el cobro de suscripciones con Mercado Pago. Ahora describe los datos enviados y consultados y separa su tratamiento propio del de los proveedores de plataforma. Evidencia: `src/lib/cobro/mercadopago.ts`, `createPreference` y `parsePayment`; no se envía `payer` ni se persisten tarjetas desde ese cliente.
2. **Importante, corregido:** la política decía 10 años para los pagos sin la condición real: `private.purge_expired_payments` solo elimina pagos de organizaciones ya borradas, con operación auditada, y no automáticamente. Se ajustó el texto al comportamiento vigente, incluyendo anulaciones. No se modificó la retención ni se ejecutó la purga.
3. **Importante, corregido:** responsable sin completar pese a la aprobación profesional. Datos publicados exclusivamente en `src/lib/legal.ts` con autorización del titular. Contacto aprobado como valor predeterminado; una variable del entorno puede sobreescribirlo. La lectura literal conserva el valor de construcción en un contenedor. La pérdida del correo en el despliegue anterior era un riesgo potencial, no un fallo reproducido: estas páginas pueden quedar prerenderizadas durante el build.
4. **Sugerencia, corregida:** la contraseña se describía como «cifrada», aunque Auth almacena un hash. El resumen de retención de IP también omitía la excepción de limpieza por actividad que sí explicaba el párrafo detallado.
5. **Importante, corregido:** el historial de pagos no emite facturas fiscales; se hace explícito que la facturación fiscal se gestiona por fuera. La emisión y conciliación fiscal siguen siendo un procedimiento del responsable y su contador, no una función implementada.
6. **Importante, corregido:** versión de aceptación y fecha legal estaban en constantes independientes. La nueva versión `2026-11-04` alimenta ambas; solo las nuevas altas registran esa versión. Las aceptaciones anteriores se conservan. Texto anterior recuperable en Git (`e0ca2f4`).

## Pendientes concretos
Actualización del 2026-11-04: el usuario pidió recomendar y aplicar las tres soluciones. Su definición, implementación y evidencia continúan en [retención, cifrado y transferencias](retencion-cifrado-transferencias.md); los puntos siguientes describen el estado detectado por esta revisión inicial.
- **Auditoría:** falta un plazo definido; no existe aquí una purga aprobada para implementarlo. Confirmar también el tratamiento del hash de email conservado para impedir pruebas repetidas; la política lo informa pero no fija un plazo.
- **Transferencias:** el visto bueno del abogado no identifica en esta sesión el mecanismo contractual aplicable a cada proveedor. Conservar el marcador hasta contar con la descripción concreta; no afirmar que las garantías ya se instrumentaron.
- **Respaldos:** el script genera SQL y archivos con hashes de verificación, no cifrado. Falta identificar el cifrado del destino/segunda copia y comprobar la programación y retención real. No sustituir el marcador por una promesa no verificada.
- **Operación:** verificar en el entorno definitivo el correo visible (una variable de build puede conservar un contacto anterior), tareas programadas, restauración y proceso externo de factura/nota de crédito. Ninguna operación remota fue ejecutada en esta revisión.

## Aceptación
- [x] Páginas públicas muestran responsable y contacto configurado, describen Mercado Pago y la retención real sin marcadores de contador.
- [x] La versión que registra el alta corresponde a la fecha legal publicada.
- [x] No cambian las reglas de cobro, retención o permisos; los tres pendientes sin datos siguen visibles.

## Fuentes consultadas (2026-11-04)
- [Ley 25.326](https://www.argentina.gob.ar/normativa/nacional/64790/texto), arts. 6, 12, 14 y 16: información del responsable, transferencias y derechos. Los plazos de derechos publicados coinciden con el texto consultado.
- [AAIP, transferencias internacionales](https://www.argentina.gob.ar/transferencias-internacionales): mecanismos y cláusulas modelo; la región de alojamiento no acredita su instrumentación.
- [ARCA, comprobantes](https://www.arca.gob.ar/facturacion/comprobantes/): distinción entre recibos que respaldan pagos y facturas. No se infiere categoría fiscal, IVA o modalidad de emisión del titular.

## Evidencia
- Sobre este diff, `pnpm test src/lib/legal.test.ts src/lib/registro/registro.test.ts src/lib/cobro/mercadopago.test.ts tests/unit/respaldar.test.ts tests/unit/verificar-produccion.test.ts`: **91/91**. Lint, typecheck y build correctos. Se comprobó además el HTML prerenderizado: contacto aprobado visible, fecha actualizada y solo tres marcadores en privacidad.
- Skill local `C:/Users/tobib/.codex/skills/revision-legal-contable-ar/SKILL.md` creada y validada con `quick_validate.py`; índice de skills regenerado (98 entradas). No se instalaron dependencias ni skills de terceros.
- Navegador: ejecución aislada contra `next start`, 390 px, sin globalSetup ni base. Primera selección: 15 pruebas legales aprobadas y una de carta incluida por error en el filtro falló por `fetch failed` (base local no disponible). Dos intentos de arranque anteriores fallaron por la carpeta de trabajo y `import.meta` en la configuración temporal; corregidos, sin afectar el código del producto. Selección corregida: **15/15** con `pnpm exec playwright test --config output/playwright.legal.config.ts` (configuración local ignorada, sin base).
- No se ejecutaron RLS, suite E2E completa, restauración ni consultas remotas: no se modificó el esquema, los permisos o las reglas de cobro/borrado. No se verificó la infraestructura real ni se emitieron facturas. Revisión de diff sin cambios ajenos; no es una certificación integral de cumplimiento.
- Recuperación local: revertir únicamente estos cambios de textos, configuración legal, versión de aceptación y pruebas; no hay migración ni datos modificados.
