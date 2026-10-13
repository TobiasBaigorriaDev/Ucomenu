---
name: agile-revisar
description: Usar para revisar implementaciones y cambios confirmados, staged, sin stage y archivos nuevos contra criterios de aceptación. Solo lectura por defecto, hallazgos con evidencia y rigor por riesgo; no implementa ni alarga auditorías.
---

# agile-revisar

Revisión proporcional al riesgo y con evidencia. **Solo lectura por defecto**: no editar código, fichas ni aplicar fixes salvo pedido explícito.

## Insumos
- Ficha relevante, criterios de aceptación, riesgo S/M/C y resultados conocidos de tests/build.
- Rama base para comparar commits **si el usuario la conoce o está documentada**. No inventar una base.
- Estado completo del árbol: cambios confirmados, staged, sin stage y archivos nuevos no ignorados.

## Cómo determinar el alcance real (primero inspeccionar)
```bash
git status --short --branch
git diff --no-ext-diff                       # cambios tracked sin stage
git diff --no-ext-diff --cached              # cambios tracked staged
git ls-files --others --exclude-standard    # archivos nuevos sin seguimiento
# Solo si hay rama base conocida y válida:
git diff --no-ext-diff <base>...HEAD          # commits de la rama desde merge-base
```
- `git diff <base>...HEAD` **no** incluye cambios sin commit y **no** incluye archivos nuevos no rastreados.
- Leer los archivos nuevos relevantes de manera selectiva. No abrir ni copiar secretos, volcados, `.env` ni otros archivos sensibles.
- Si no hay commits suficientes o una base conocida, revisar el estado disponible y declarar el alcance y sus limitaciones; no asumir que el diff de rama está vacío.
- Separar siempre los hallazgos de *commits*, *staged*, *sin stage* y *untracked* para no omitir cambios.

## Procedimiento
1. Entender objetivo, specs **vigentes** e invariantes antes de emitir conclusiones.
2. Comparar implementación y criterios. Ante discrepancias, no dar por correcto el código o las specs automáticamente: pedir resolución cuando afecte negocio.
3. Inspeccionar seguridad, permisos, validaciones, excepciones, integridad de datos, compatibilidad y accesibilidad cuando corresponda.
4. Usar evidencias de pruebas ya ejecutadas. Ejecutar pruebas **solo si están permitidas y no alteran el repositorio**; si generan archivos, preferir entorno aislado o pedir autorización, y declarar lo no probado.
5. Detectar cambios ajenos al objetivo, regresiones y riesgos. Para C: invariantes, idempotencia, concurrencia, recuperación y rollback.

## Informe
Para cada hallazgo: **Bloqueante / Importante / Sugerencia**, archivo y línea, evidencia o reproducción, consecuencia y alcance del diff en que aparece.
Cerrar con pruebas realmente verificadas, pruebas no ejecutadas, archivos sin revisar y veredicto (aprobar / aprobar con cambios / rechazar).

## Límites
- No inventar defectos ni declarar aprobación completa si quedaron archivos o flujos sin examinar.
- Una ronda de revisión suele bastar, salvo defectos graves o cambios nuevos sustantivos.
- El implementador reproduce los hallazgos; el revisor no corrige por su cuenta.
- No confundir la afirmación de un agente con ejecución comprobada de tests.
