# 0029 — Categorías y platos se borran con el cliente de la persona, con confirmación comprobada en el servidor y las fotos limpiadas después de confirmar

- Estado: aceptada para la implementación actual (revisión independiente aprobada; publicación y despliegue autorizados por el usuario el 2026-10-21, sin cambiar la RLS vigente)
- Fecha: 2026-10-21

## Contexto
Hasta ahora categorías y platos solo se desactivaban ([ADR 0008](0008-fotos-de-platos-en-storage.md) y la ficha de gestión de carta): borrar una categoría arrastra a sus platos por cascada y deja huérfanas sus fotos en Storage, que la base no puede borrar. La RLS ya permitía el `DELETE` a Dueño y Staff con la cuenta al día; faltaba la acción, la limpieza y decidir qué se conserva.

## Decisión
1. **Sin migración ni permisos nuevos.** El borrado va con el cliente de la persona (RLS), con la misma regla que el resto de la carta: miembro del local y cuenta al día (en solo lectura y suspendida no se borra). Un `DELETE` descartado por RLS (0 filas) nunca se informa como éxito.
2. **Storage después de la base** (el mismo criterio que el [ADR 0028](0028-borrado-definitivo-de-organizaciones.md)): se borra la fila y, recién confirmada, se limpian `product-images/{org}/{plato}/` (la ruta guardada y los archivos sueltos de esa carpeta). Si Storage falla o descarta el borrado, la fila ya no existe: se avisa en pantalla y se registra con la organización y el plato.
3. **Solo se borra lo que la persona vio.** El servidor recuenta los platos de la categoría: si no coinciden con los que se mostraron, no borra; si tiene platos, exige el nombre exacto. El navegador solo guía.
4. **El historial de precios se conserva** (ADR 0012: sin clave foránea al plato; la pantalla muestra «Plato eliminado»). Se pierden, a propósito y avisado, las variantes, adicionales, disponibilidad, traducciones y vistas contadas del plato.

## Alternativas consideradas
- **Función de base que borre y devuelva las rutas de las fotos** — ahorra la ventana entre la lectura y el borrado, pero agrega una migración y una superficie para un acto que ya cubre la RLS; la ventana solo permite borrar un plato recién creado y sin foto.
- **Limpiar Storage antes** — un borrado que falle dejaría platos sin foto.
- **Solo el Dueño borra categorías con platos** — cambia permisos de negocio: sería una decisión y un cambio aparte; la implementación publicada conserva la RLS vigente.
- **Papelera con borrado diferido** — desproporcionado; «Desactivar» ya es la baja reversible.

## Consecuencias
- Irreversible: solo el respaldo (`docs/operacion.md`) lo cubre.
- Posibles archivos sueltos si el servidor se corta justo después de la base (inofensivos: nadie los enlaza; riesgo aceptado como en el ADR 0028).
- El Staff puede borrar una categoría entera (con el nombre escrito).
