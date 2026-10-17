# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Codex · historial anterior en `agile/historial.md`.

## Punto de retomada

Objetivo de esta sesión: comprobar si la migración de desactivar sucursales estaba aplicada en staging, para que el usuario pueda evaluar la aprobación de la tarea. La comprobación remota terminó y quedó documentada en la [ficha](cambios/desactivar-sucursales.md), sección de verificación de staging. El estado anterior de esa ficha y el tablero estaba desactualizado: decía que la migración seguía solo en local. Se corrigió con evidencia del entorno, sin inferir una aprobación humana nueva.

Rama actual `feat/revision-claude`, base de esta comprobación `fdcb066`. Las consultas usaron la CLI autenticada existente y el proyecto enlazado, previamente identificado como staging. Solo se consultaron metadatos, catálogos y el historial de migraciones; no se leyeron datos de negocio, no se ejecutaron migraciones ni se modificaron datos. El SQL de comprobación se conserva en `output/verificacion-staging-desactivar.sql`, ignorado por Git.

La integración de revisiones sigue en esta rama local, pendiente de incorporarse a `main` antes de abrir otra rama desde allí. El procedimiento en ambos sentidos está en la [guía](../docs/revision-entre-agentes.md); la skill de revisión de Claude permanece exclusiva de tareas C, conforme al ADR 0019.

## Bloqueos y riesgos

Esta comprobación confirma la base de staging; no verifica el despliegue de la app en Fly ni el flujo desde su interfaz. El despliegue figuraba pendiente en el estado heredado. Producción continúa fuera de alcance: [ficha de salida](cambios/salida-a-produccion.md), ADR 0015.

Siguen pendientes la comprobación en teléfono real y el posible rediseño de login, sala y cuenta.

## Próximo paso

Entregar la evidencia al usuario para su evaluación. Si pide validar la interfaz, confirmar primero qué versión está desplegada y obtener autorización antes de desplegar o modificar datos remotos. Para otra tarea local, conservar la configuración de revisiones al elegir la rama de partida.
