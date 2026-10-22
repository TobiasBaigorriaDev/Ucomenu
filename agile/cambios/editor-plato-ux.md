# Cambio: edición de platos por tarea

Estado: hecho y commiteado (2026-10-21, aprobado por el usuario); desplegado en staging (Fly v18, commit `f63ee27`, 2026-10-21). Nivel M: presentación y navegación local; conserva acciones, reglas, permisos y persistencia.

## Decisiones

El usuario solicita reducir el recorrido de edición en PC y elige explícitamente
«Datos y foto juntos + pestañas». Se conserva el sistema visual del panel.

- Datos y foto comparten fila en escritorio amplio; datos aprovechan el ancho con precio y categoría juntos y etiquetas en línea.
- Pestañas Datos y foto, Variantes y Sucursales; paneles permanecen montados para preservar borradores y fotos elegidas.
- Historial accesible en encabezado. Borrado conserva su confirmación existente y queda separado del trabajo habitual.
- Móvil vuelve a una columna; navegación de pestañas por teclado, foco y semántica accesibles.
- Sin cambiar endpoints, cálculos de precios, reglas de sucursales, altas ni acciones destructivas.
- Ajuste S posterior pedido por el usuario: distinguir Tamaño, Extras y demás grupos con cabeceras arena, títulos de 24 px y mayor separación; Nuevo grupo también separado por filete.

## Aceptación

- Cambiar pestañas no pierde valores sin guardar; acciones y mensajes permanecen en su panel después de guardar.
- Editar y guardar datos, foto, opciones y sucursales sigue funcionando.
- A 1440 px datos y foto aparecen juntos; a 390 px no hay desborde. A 1024 px el formulario sigue usable.
- Pestañas responden a clic, flechas, Inicio/Fin y Tab con foco visible.
- Pantallas bloqueadas conservan controles deshabilitados. Alta de plato conserva su disposición.

## Evidencia

2026-10-21, diff sobre `68cfb60`, preservando la corrección previa del selector de Sala sin commit:

- `pnpm db:start` + `pnpm db:reset` locales antes de E2E. `pnpm build`, `pnpm lint`, `pnpm typecheck`: OK.
- `pnpm exec playwright test e2e/editor-plato.spec.ts e2e/carta.spec.ts e2e/opciones.spec.ts e2e/disponibilidad.spec.ts e2e/carta-por-sucursal.spec.ts --workers=1`: **44/44**. Incluye guardados, foto, variantes, ajustes por sucursal, validación, modos bloqueados y alta.
- En inspección visual las pestañas móviles ocupaban dos filas: se compactaron; build y lint finales OK; repetición `pnpm exec playwright test e2e/editor-plato.spec.ts --workers=1`: **3/3**, con comprobación adicional de pestañas en una fila. Solo ese estilo y formato de JSX cambiaron después de los 44 casos.
- Pruebas nuevas a 390/1024/1440 px: disposición, borradores de nombre y grupo, foto y archivo conservados entre pestañas, guardado y navegación con flechas/Inicio/Fin/Tab. Capturas en directorios de `test-results/editor-plato-*` (ignorados por Git).
- Revisión de navegador Chrome en demo a 1440 y 390 px: datos/foto agrupados, sucursales en columnas, sin desborde. Pestañas de 44 px. Detector de layout sin hallazgos; se conserva paleta, tipografía y estados del panel. No se refrescó el sidecar de diseño ajeno al alcance.
- Revisión independiente de fuente por agente de layout, solo lectura: aprobada, sin hallazgos. Diff leído, `git diff --check` OK. No se ejecutaron RLS ni suites globales: sin cambios en esquema, acciones ni permisos; teléfono físico y lector de pantalla no probados.
- Demo y escenarios locales restaurados después de suite amplia; servidor `next start` reiniciado en **http://localhost:3001** con el build final para probar. No se subió ni desplegó.
- Ajuste visual de grupos posterior: `pnpm build` y ESLint del componente OK; `pnpm exec playwright test e2e/opciones.spec.ts --workers=1` **8/8**. Inspección de demo en Chrome en escritorio y 390 px, sin desborde. Servidor 3001 reiniciado con este ajuste. Sin cambios funcionales ni pruebas nuevas.
