# Prompts de ejemplo

Solicitudes sugeridas. **No son código ejecutable.** Adaptá lo que está entre [corchetes]. No pegues el manual completo en los prompts.

## Empezar un proyecto nuevo
> Leé `AGENTS.md`, `docs/producto.md`, `docs/arquitectura.md` y `agile/ahora.md`. Inspeccioná el repo y decime cuáles son las restricciones verificadas, los principales riesgos y tres próximos incrementos posibles. No instales nada ni generes documentación extra sin necesidad. Recomendá un incremento con criterios de aceptación concretos.

## Explorar un proyecto desde cero (Claude Code)
> Quiero crear [producto] usando Agile SDD 1.1.1. Consultá `AGENTS.md` y usá `agile-explorar`. Antes de escribir código, ayudame a definir usuarios, MVP, reglas de negocio, permisos, costos y arquitectura. No tomes decisiones de negocio importantes sin consultarme. Registrá solo las conclusiones aceptadas en `docs/producto.md` y `docs/arquitectura.md`; creá fichas en `agile/cambios/` si ya hay incrementos concretos; actualizá `agile/ahora.md`. No instales nuevas herramientas.

## Explorar una funcionalidad
> Quiero [funcionalidad]. Explorá el código afectado, detectá preguntas realmente bloqueantes y proponé un alcance mínimo. Si corresponde a nivel M o C, creá o actualizá una ficha breve en `agile/cambios/`. No supongas reglas de negocio sin verificarlas.

## Implementar un cambio (cualquier agente)
> Leé `AGENTS.md`, `agile/ahora.md` y la ficha, si existe (de `docs/` solo lo pertinente). Aplicá `agile-iterar` para [objetivo]. Fijá el nivel por consecuencias (autorización, exposición de información, dinero, eliminación irreversible → C). Si el alcance está claro, implementá sin explorar. Corré pruebas por impacto durante el trabajo y la comprobación completa solo si la integración la justifica. Si aprendés algo que invalida la ficha, actualizala antes de continuar. Resumí evidencias, lo no ejecutado y pendientes.

## Buscar una skill útil
> Evaluá si esta tarea [descripción] se beneficia de capacidades existentes. Primero revisá skills y herramientas ya disponibles. Solo si hay una brecha, buscá hasta tres skills externas; compará mantenimiento, licencia, scripts, permisos y utilidad. Recomendá una o ninguna y pedime autorización antes de instalar o ejecutar terceros.

## Frontend con descubrimiento
> Necesito un dashboard responsive, accesible y consistente con el diseño del proyecto. Analizá primero el sistema visual actual. Si Impeccable u otra skill revisada aportaría mejoras concretas, evaluá su uso. No agregues dependencias externas nuevas sin autorización. Implementá un incremento vertical y verificá estados vacíos, errores, teclado y pantallas pequeñas.

## Revisión independiente de un cambio C (solo lectura)
> Aplicá `agile-revisar` sin modificar archivos sobre [commit o rama]. Compará con la aceptación de la ficha y revisá `git status`, commits respecto de [base, si está definida], cambios staged, sin stage y archivos nuevos relevantes. Apoyate en las pruebas ya registradas para ese commit; corré solo lo que falte. Separá defectos demostrables de riesgos y sugerencias, con archivo/línea y evidencia, y listá lo no revisado. Una ronda normal: sin bucles por estilo.

## Re-revisar tras correcciones (solo lectura)
> Aplicá `agile-revisar` sobre [commit nuevo]. Limitate a verificar que los hallazgos de la ronda anterior quedaron corregidos y a buscar regresiones en el diff nuevo; ampliá solo si el cambio es sustantivo.

## Retomar con otra IA
> Leé `AGENTS.md`, `agile/ahora.md`, la ficha del cambio actual y el diff relevante (no `agile/historial.md`, salvo un detalle puntual). Consultá memoria histórica solo si ayuda a este módulo y verificá su vigencia con código y Git. Decime qué está realmente hecho, qué pruebas faltan y cuál sería el siguiente incremento más útil.

## Cerrar sesión
> Reescribí `agile/ahora.md` (250–350 palabras: objetivo, rama/commit, bloqueos, próximo paso; sin historia ni listas de pruebas). Dejá la evidencia en la ficha, una línea de estado en `agile/tablero.md` y promové a `docs/decisiones/` solo decisiones duraderas.

## Completar comandos del proyecto
> Inspeccioná el repo y completá la sección «Comandos del proyecto» de `AGENTS.md` con los comandos reales de instalación, test, lint, typecheck, build y migraciones. Si alguno no existe, dejalo como TODO y decime qué recomendarías.
