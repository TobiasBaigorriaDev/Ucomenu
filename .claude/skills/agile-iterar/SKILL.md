---
name: agile-iterar
description: Usar para implementar un incremento vertical, acotado y verificable (cambios S, M o C) con cambios focalizados, pruebas pertinentes y actualización del estado. Elige el próximo trabajo desbloqueado por valor y riesgo, no por número de tarea.
---

# agile-iterar

Implementar **un** incremento pequeño que funcione de extremo a extremo.

## Antes de empezar
1. Leer `AGENTS.md`, `agile/ahora.md` y la ficha del cambio (si existe).
2. Confirmar el nivel S/M/C. Ante duda sobre dinero, datos, permisos o migraciones → tratar como **C**.
3. Revisar `git status`: si hay cambios ajenos o incompletos, resolverlos o consultarlos antes de seguir.
4. Elegir el incremento: el de mayor valor/urgencia/reducción de riesgo **sin dependencias bloqueantes**. No seguir un orden numérico solo porque está escrito.

## Durante
- Cambios focalizados; **sin refactors ajenos** al objetivo.
- Seguir los patrones del repo; reutilizar componentes y utilidades existentes.
- TDD recomendado para reglas delicadas y bugs reproducibles; no obligatorio para cambios triviales.
- Commits pequeños en una rama aislada cuando el cambio lo amerite.
- Si aprendés algo que invalida la especificación: **actualizar la ficha, explicar el motivo y recién después seguir** con decisiones importantes. Se puede volver a `agile-explorar`.
- No pedir permiso para modificaciones locales, reversibles y seguras.
- **Sí** pedir aprobación para: dependencias nuevas, terceros, despliegues, migraciones destructivas, producción, secretos.

## Verificar
- Ejecutar tests/lint/typecheck/build pertinentes (comandos en `AGENTS.md`).
- Comparar contra los criterios de aceptación y contra el comportamiento preexistente.
- Inspeccionar `git diff` y detectar cambios fuera de alcance.
- Nivel C: invariantes, casos de falla, recuperación/rollback y aprobación humana.

## Cierre
- Informar: qué se hizo, **pruebas ejecutadas (resultado)**, pruebas no ejecutadas y por qué, riesgos pendientes.
- Actualizar la ficha (estado, evidencias) y `agile/ahora.md`.
- Actualizar `agile/tablero.md` si cambió el estado de algún ítem.
- Promover decisiones duraderas a `docs/decisiones/`.
- Si Engram está habilitado: guardar una nota breve solo de decisiones/hallazgos costosos de repetir. Nunca como sustituto de los documentos.

## Prohibido
- Declarar «terminado» sin evidencia.
- Dejar el repositorio en un estado a medias sin registrarlo en `agile/ahora.md`.
