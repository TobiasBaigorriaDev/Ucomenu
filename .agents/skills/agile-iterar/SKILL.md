---
name: agile-iterar
description: Usar para implementar un incremento vertical, acotado y verificable (cambios S, M o C) con cambios focalizados, pruebas por impacto y estado actualizado. Elige el próximo trabajo desbloqueado por valor y riesgo, no por número de tarea.
---

# agile-iterar

Implementar **un** incremento pequeño que funcione de extremo a extremo. Las reglas de nivel, verificación y revisión están en `AGENTS.md`; acá solo el procedimiento.

## Antes de empezar
1. Leer `AGENTS.md`, `agile/ahora.md` y la ficha (si existe). Si el alcance ya está claro, no explorar: implementar.
2. Fijar el nivel **por consecuencias** (autorización, exposición de información, dinero, eliminación irreversible → C; resto, S o M). Ante duda sobre esas consecuencias, subir un nivel.
3. Revisar `git status`: preservar los cambios previos; si son ajenos o incompletos, consultarlos antes de seguir.
4. Elegir el incremento de mayor valor o menor riesgo **sin dependencias bloqueantes**, no por número.

## Flujo por nivel
- **S:** implementar → comprobación afectada → leer el diff. Sin ficha ni segundo agente.
- **M:** ficha breve (decisiones + aceptación) → implementar → pruebas pertinentes.
- **C:** ficha con invariantes, fallos y recuperación → implementar → pruebas de integración pertinentes → una revisión independiente (`agile-revisar`) → aprobación humana antes de lo peligroso.

## Durante
- Cambios focalizados, sin refactors ajenos; seguir los patrones del repo. TDD para reglas delicadas y bugs reproducibles.
- Si lo aprendido invalida la ficha: actualizarla, explicar el motivo y recién seguir.
- Sin permiso: cambios locales y reversibles. Con aprobación: dependencias, terceros, despliegues, migraciones destructivas, producción, secretos, reglas de negocio críticas.

## Verificar
- Durante la iteración: pruebas filtradas por impacto. Al integrar o entregar: la comprobación completa que el cambio justifique, no una por ritual.
- Repetir ante fallos, cambios posteriores o incertidumbre; un fallo ajeno se repite una vez y se anota.
- Mutaciones solo para un riesgo concreto; mejor dejar una prueba de regresión que falle sin la defensa.
- Cambios solo de documentación o metodología: sin build, RLS ni E2E.
- Comparar con la aceptación y revisar `git diff` por cambios fuera de alcance.

## Cierre
- Informar: qué se hizo, pruebas ejecutadas (resultado), no ejecutadas (por qué), riesgos pendientes.
- Evidencia en la ficha, ligada al commit o diff probado. Tablero: una línea (estado + enlace). `agile/ahora.md`: **reescribirlo** (250–350 palabras), no acumular. Decisiones duraderas → `docs/decisiones/`.
- Engram, si está habilitado: solo decisiones o hallazgos costosos de repetir; nunca sustituye a los documentos.

## Prohibido
- Declarar «terminado» sin evidencia. Dejar el repo a medias sin registrarlo en `agile/ahora.md`.
