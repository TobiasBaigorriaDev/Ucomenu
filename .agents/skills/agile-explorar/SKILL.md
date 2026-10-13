---
name: agile-explorar
description: Usar cuando el trabajo requiere entender el código existente, aclarar una idea ambigua, investigar opciones o convertir una necesidad difusa en alcance y criterios verificables, antes de escribir código. No usar para cambios simples y claros (nivel S).
---

# agile-explorar

Reducir incertidumbres **reales** sin documentar por documentar.

## Cuándo activarla
- «Quiero un módulo de X pero no sé exactamente cómo».
- Hay reglas de negocio, permisos, datos o integraciones poco claras.
- Se necesita comparar alternativas técnicas con impacto duradero.

## Cuándo NO
- Cambios S (texto, estilo, bug aislado). Ir directo a `agile-iterar`.
- Cuando la ficha ya existe y es clara.

## Procedimiento
1. Leer `agile/ahora.md` y, si existen, la ficha relevante y las secciones pertinentes de `docs/`.
2. Inspeccionar el repo: patrones existentes, módulos afectados, esquema de datos, tests.
3. Separar **lo verificado** (en código/docs) de **lo supuesto**.
4. Preguntar al usuario **solo** lo que cambie una decisión importante (negocio, seguridad, dinero, arquitectura). Agrupar las preguntas; no interrogar por detalles que se pueden decidir y revertir.
5. Para asuntos grandes: presentar 2–3 alternativas con ventajas, riesgos y una recomendación.
6. Investigar fuentes externas solo si aportan información necesaria o que pudo cambiar; citar la fuente.
7. Proponer el **alcance mínimo** y el nivel de rigor (S/M/C).

## Salida esperada
- Comprensión del problema y decisiones ya conocidas.
- Preguntas realmente bloqueantes (si las hay).
- Alcance propuesto + criterios de aceptación comprobables.
- Nivel S/M/C justificado por riesgo.
- Si es M o C: crear/actualizar `agile/cambios/<nombre>.md` desde `_plantilla.md`.
- Registrar en `docs/` y `docs/decisiones/` **solo conclusiones aceptadas por el usuario**.

## Reglas
- No escribir código de producción durante la exploración (salvo spikes descartables y declarados).
- No suponer reglas de negocio: verificarlas o preguntarlas.
- No instalar herramientas nuevas. Si hace falta una skill especializada, usar `agile-descubrir-skills`.
- No generar documentos largos: un criterio útil es «Cuando X, entonces Y comprobable», no «que funcione bien».
