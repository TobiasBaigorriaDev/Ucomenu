# Prompts de ejemplo

Solicitudes sugeridas. **No son código ejecutable.** Adaptá lo que está entre [corchetes]. No pegues el manual completo en los prompts.

## Empezar un proyecto nuevo
> Leé `AGENTS.md`, `docs/producto.md`, `docs/arquitectura.md` y `agile/ahora.md`. Inspeccioná el repo y decime cuáles son las restricciones verificadas, los principales riesgos y tres próximos incrementos posibles. No instales nada ni generes documentación extra sin necesidad. Recomendá un incremento con criterios de aceptación concretos.

## Explorar un proyecto desde cero (Claude Code)
> Quiero crear [producto] usando Agile SDD 1.1.1. Consultá `AGENTS.md` y usá `agile-explorar`. Antes de escribir código, ayudame a definir usuarios, MVP, reglas de negocio, permisos, costos y arquitectura. No tomes decisiones de negocio importantes sin consultarme. Registrá solo las conclusiones aceptadas en `docs/producto.md` y `docs/arquitectura.md`; creá fichas en `agile/cambios/` si ya hay incrementos concretos; actualizá `agile/ahora.md`. No instales nuevas herramientas.

## Explorar una funcionalidad
> Quiero [funcionalidad]. Explorá el código afectado, detectá preguntas realmente bloqueantes y proponé un alcance mínimo. Si corresponde a nivel M o C, creá o actualizá una ficha breve en `agile/cambios/`. No supongas reglas de negocio sin verificarlas.

## Implementar sin plan rígido (Codex)
> Leé `AGENTS.md`, `docs/producto.md`, `docs/arquitectura.md`, `agile/ahora.md` y la ficha relevante. Aplicá `agile-iterar`. Implementá el incremento verificable de mayor valor para [objetivo], respetando dependencias reales. Elegí el siguiente paso según el estado actual, no por número de tarea. Si aprendés algo que invalida la especificación, actualizala antes de continuar. Ejecutá las pruebas pertinentes y resumí evidencias y pendientes.

## Buscar una skill útil
> Evaluá si esta tarea [descripción] se beneficia de capacidades existentes. Primero revisá skills y herramientas ya disponibles. Solo si hay una brecha, buscá hasta tres skills externas; compará mantenimiento, licencia, scripts, permisos y utilidad. Recomendá una o ninguna y pedime autorización antes de instalar o ejecutar terceros.

## Frontend con descubrimiento
> Necesito un dashboard responsive, accesible y consistente con el diseño del proyecto. Analizá primero el sistema visual actual. Si Impeccable u otra skill revisada aportaría mejoras concretas, evaluá su uso. No agregues dependencias externas nuevas sin autorización. Implementá un incremento vertical y verificá estados vacíos, errores, teclado y pantallas pequeñas.

## Revisión independiente (solo lectura)
> Aplicá `agile-revisar` sin modificar archivos. Compará con criterios aceptados y revisá `git status`, commits respecto de [base, si está definida], cambios staged, sin stage y archivos nuevos relevantes. Separá defectos demostrables de riesgos y sugerencias; incluí archivo/línea, evidencia, pruebas ejecutadas y alcance no revisado. No abras otra ronda por preferencias de estilo.

## Retomar con otra IA
> Leé `AGENTS.md`, `agile/ahora.md`, la ficha del cambio actual y el diff relevante. Consultá memoria histórica solo si está habilitada y ayuda a este módulo; verificá su vigencia con código y Git. Decime qué está realmente hecho, qué pruebas faltan y cuál sería el siguiente incremento más útil.

## Cerrar sesión
> Actualizá `agile/ahora.md` (objetivo, rama/commit, cambios, pruebas con resultado, bloqueos, próximo paso) y el estado de la ficha y de `agile/tablero.md`. Promové a `docs/decisiones/` solo decisiones duraderas.

## Completar comandos del proyecto
> Inspeccioná el repo y completá la sección «Comandos del proyecto» de `AGENTS.md` con los comandos reales de instalación, test, lint, typecheck, build y migraciones. Si alguno no existe, dejalo como TODO y decime qué recomendarías.
