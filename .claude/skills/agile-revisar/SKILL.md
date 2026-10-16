---
name: agile-revisar
description: Usar para revisar implementaciones y cambios confirmados, staged, sin stage y archivos nuevos contra criterios de aceptación. Solo lectura por defecto, hallazgos con evidencia y rigor por riesgo; no implementa ni alarga auditorías.
---

# agile-revisar

Revisión proporcional al riesgo y con evidencia. **Solo lectura por defecto**: no editar código, fichas ni aplicar fixes salvo pedido explícito.

## Cuándo corresponde
- **C:** una revisión independiente normal (otro agente o sesión limpia).
- **M:** solo si hay duda o el usuario la pide. **S:** no por defecto.
- **Rondas siguientes:** verificar las correcciones y posibles regresiones del diff nuevo; ampliar el alcance solo ante cambios sustantivos. Sin bucles por estilo.

## Insumos
- Ficha, criterios de aceptación, nivel y resultados de pruebas ya registrados (con su commit o diff). Rama base solo si es conocida; no inventarla.
- Estado completo del árbol: confirmados, staged, sin stage y archivos nuevos no ignorados.

## Alcance real (inspeccionar primero)
```bash
git status --short --branch
git diff --no-ext-diff                       # tracked sin stage
git diff --no-ext-diff --cached              # tracked staged
git ls-files --others --exclude-standard    # nuevos sin seguimiento
git diff --no-ext-diff <base>...HEAD          # solo con base conocida y válida
```
- `<base>...HEAD` no incluye cambios sin commit ni archivos nuevos. Separar hallazgos de *commits*, *staged*, *sin stage* y *untracked*.
- Leer selectivamente los archivos nuevos relevantes; no abrir secretos, `.env` ni volcados. Sin base suficiente, declarar el alcance y sus límites.

## Procedimiento
1. Entender objetivo, specs **vigentes** e invariantes. Ante discrepancia código/spec, no dar la razón a ninguno por defecto: pedir resolución si afecta negocio.
2. Inspeccionar lo que el nivel exige: permisos, validaciones, integridad, compatibilidad, accesibilidad. En C: invariantes, idempotencia, concurrencia, recuperación y rollback.
3. Apoyarse en las pruebas ya registradas para ese commit o diff; ejecutar solo las que falten o dependan de lo dudoso, si están permitidas y no ensucian el repo. No repetir suites completas por ritual.
4. Detectar cambios ajenos, regresiones y riesgos.

## Informe
Por hallazgo: **Bloqueante / Importante / Sugerencia**, archivo y línea, evidencia, consecuencia y parte del diff. Cerrar con pruebas verificadas, no ejecutadas, archivos sin revisar y veredicto (aprobar / aprobar con cambios / rechazar).

## Límites
- No inventar defectos ni aprobar por completo si quedaron flujos sin examinar.
- El implementador reproduce y corrige; el revisor no corrige por su cuenta.
- No confundir la afirmación de un agente con una prueba ejecutada.
