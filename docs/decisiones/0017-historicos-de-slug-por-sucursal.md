# 0017 — Conservar identificadores anteriores en la sucursal

- Estado: aceptada como decisión técnica del incremento solicitado.
- Fecha: 2026-10-16

## Contexto
El usuario pidió corregir slugs desde SuperAdmin sin romper enlaces. Los QR ya usan ids y tokens estables. Dueño y Staff no deben recibir permiso para modificar direcciones.

## Decisión y motivos
Conservar los slugs anteriores en `branches.slug_aliases`, calculados por trigger, aprovecha las políticas de publicación existentes y evita una tabla pública o una RPC nueva de resolución. El cambio de slug y su histórico se confirman juntos. No se agregan privilegios por columna al cliente de miembros.

Los históricos se reservan en el espacio de nombres de la organización: reutilizarlos para otra sucursal mandaría un enlace compartido al lugar equivocado. Un lock por organización coordina altas y correcciones, ya que el índice único de slug actual no puede proteger elementos de un arreglo. Volver a un slug propio anterior sí se permite y se lo retira de los alias.

El menú obtiene la sucursal actual mediante RLS y responde 308 al nombre vigente, evitando cadenas en el servidor. Ante suspensión conserva la pantalla de no disponible y ante inactividad no publica nada. Los QR no se regeneran. El formulario incluye el slug esperado para rechazar una pantalla obsoleta.

## Consecuencias
La lista de históricos crece solo con correcciones administrativas. No hay borrado ni reasignación de alias en este incremento; retirarlos rompería enlaces. Cambiar a un identificador propio previo permite recuperar una dirección sin eliminar el historial. Evidencia en [la ficha](../../agile/cambios/correccion-slug-sucursal.md).
