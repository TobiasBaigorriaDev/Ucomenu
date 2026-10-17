# Cambio: disponibilidad por sucursal — marcar agotado

Estado: **Integrado a `main` (local)**. Integrado a `main` el 2026-10-17 por decisión explícita del usuario, con la comprobación completa de la entrega (ver «Integración»). La revisión independiente C en sesión limpia no se hizo: solo hubo la lectura de Claude Code del 2026-10-17, sin hallazgos bloqueantes. Sin push ni despliegue.
Nivel: **M de producto, C técnico** por tabla y políticas nuevas.

## Decisiones y alcance
- Un plato compartido puede estar agotado en una sucursal y disponible en otra. Sin registro se considera disponible. Se conserva visible con la leyenda Agotado, precio y detalle.
- Dueño y Staff cambian el estado desde la pantalla del plato para cada sucursal; acciones explícitas e idempotentes, sin alternar a ciegas ni modificar is_active.
- Estado por (sucursal, plato), con organization_id y claves foráneas compuestas. No se pueden mover registros entre organizaciones, sucursales o platos ni borrarlos por la API.
- La cuenta en solo lectura/suspendida bloquea escrituras. Consulta pública solo de platos publicados y cuenta visible. Disponibilidad leída en vivo por sucursal, fuera de la caché compartida de catálogo.
- No incluye cantidades, reservas, pedidos, agotado por opción ni desactivar sucursales.
- Arquitectura y motivo de la escritura sin upsert en [ADR 0016](../../docs/decisiones/0016-etiquetas-y-disponibilidad-de-carta.md). El modelo planeado `branch_product_availability` se concreta como `product_availability`; sin cambios de producto.

## Aceptación
- [x] Dueño y Staff marcan agotado/restablecen; mensaje y estado persistente sin falso éxito.
- [x] Agotar en una sucursal no cambia otra ni desactiva el plato; carta directa, QR, búsqueda y detalle concuerdan.
- [x] Sin registro equivale a disponible. Repetir una acción conserva el estado deseado.
- [x] RLS y claves compuestas impiden escrituras ajenas/anónimas y referencias cruzadas; identificadores son inmutables.
- [x] Solo lectura/suspensión bloquean UI y escritura directa; miembros siguen consultando y anónimos no ven registros de platos ocultos o cuentas suspendidas.
- [x] Móvil/escritorio sin desborde; pruebas y diff revisado.

## Invariantes, fallos y recuperación
No cambia precio, cupos, publicación ni permisos de otras tablas. La base es autoridad; formulario no concede permisos. Toda escritura confirma fila y estado; error no se anuncia como éxito. La lectura pública se pagina y falla completa si hay error. Revertir UI/lectura devuelve la presentación anterior; conservar la tabla preserva estados. Retirar la tabla requeriría una migración revisada y respaldo. Solo base local durante este incremento.

## Evidencia
Diff probado y confirmado en **`7be826f`**, sobre `ead868e` en `feat/busqueda-y-disponibilidad`: disponibilidad y correcciones de integración. El cierre documental posterior no modifica ese código.
- `pnpm test:rls tests/rls/availability.rls.test.ts`: **8/8**, incluidos seis escritores simultáneos sobre una fila inexistente, inmutabilidad de claves, referencias cruzadas y bloqueo por mora.
- `pnpm test`: **441/441**. `pnpm test:rls` completo: **600/600** en 25 archivos, secuencialmente antes de E2E.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` y `git diff --cached --check`: correctos, incluyendo build nuevo después de corregir el encabezado accesible.
- La corrida E2E completa detectó un encabezado que heredaba «Ver detalle de…» del botón hijo; se fija su nombre accesible al del plato. También se corrige el selector posicional del fieldset de foto en las cuatro pruebas de acción forzada con mora: ahora se ubica por su formulario, conservando las aserciones de bloqueo real.
- `pnpm exec playwright test --workers=2`: **239/244**, con los cinco fallos anteriores. Después de corregirlos y compilar: `pnpm exec playwright test e2e/disponibilidad.spec.ts e2e/buscador.spec.ts e2e/carta.spec.ts e2e/menu.spec.ts --workers=2`: **37/38**; el escenario nuevo debía limpiar cookies antes de cambiar de Dueño a Staff (`/login` redirige si ya hay sesión). Corregida esa preparación, `pnpm exec playwright test e2e/disponibilidad.spec.ts --workers=2`: **3/3**. Quedaron comprobados todos los casos que habían fallado; no se repitió la suite completa sin necesidad. Sin fallos pendientes conocidos.
- E2E verifica cambio directo por la API sin invalidar caché de Next: se refleja al recargar. Inspección visual de panel y detalle a 390/1280 px: correcta. Servidor de desarrollo conservado en 3000; `/m/cafe-ejemplo/centro` responde 200 y muestra el buscador.
- Migración aditiva aplicada con `supabase migration up --local` y tipos regenerados con `pnpm db:types`. Sin `db:reset` ni resembrado para conservar el estado de la prueba manual del usuario; los escenarios nuevos son propios. El seed agrega un ejemplo explícito disponible, sin alterar las expectativas de publicación.
- Revisión independiente y aprobación humana C pendientes. Sin cambios remotos ni despliegue.

Límite de reversión: disponibilidad completa (tabla, lectura por sucursal, formulario y estado en carta/detalle). No requiere revertir búsqueda ni etiquetas de `ead868e`. Tamaño autoral mayor a 400 líneas: la unidad funcional queda en un commit local; antes de abrir PR, dividir contratos de persistencia y recorrido del panel/carta en una cadena revisable, conservando pruebas.

## Integración (2026-10-17)
Avance rápido de `main` (`dc4d102`) a la rama de trabajo, 11 commits lineales (búsqueda, disponibilidad, corrección de slug, arreglo del detalle y aviso de alérgenos). Comprobación completa sobre ese estado: `pnpm test` **443/443**; `pnpm test:rls` completo **607/607**; `pnpm exec playwright test --workers=2` completo **246 pasaron, 1 omitida** (el spec solo de desarrollo), 0 fallos. Una primera corrida completa tuvo una cascada de fallos desde la prueba ~195, con tiempos de ~1 s; no se repitió ni se diagnosticó y la segunda corrida completa salió limpia. Una prueba RLS del seed falló antes por el estado de la demo local (la sucursal había quedado como `central`, con `centro` como alias tras la prueba manual del slug); se restauró el slug con un `UPDATE` normal y pasó. No se ejecutó `db:reset`.
