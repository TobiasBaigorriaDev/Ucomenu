# Cambio: Listas completas, reordenamientos atómicos, reemplazo de imágenes sin huérfanos y vistas previas liberadas
Estado: **para verificar** — implementado, probado en local y aprobado por Codex (3 rondas); falta la aprobación humana
Nivel: C (nuevas funciones RPC con permiso `EXECUTE` a `authenticated`; eliminación irreversible de archivos de clientes en Storage; escrituras de orden sobre la carta pública)

Cuatro correcciones surgidas de una auditoría, confirmadas contra el código antes de tocarlas. Decisión duradera: [ADR 0033](../../docs/decisiones/0033-orden-e-imagenes-atomicos.md). Documentación de Next releída: `updateTag` (solo en *server actions*, vence la caché de la etiqueta en el acto) y `revalidatePath`; no se cambió ninguna API de Next.

## 5. Truncamientos silenciosos de listas
**Confirmado.** `loadCarta`, `loadMesas`, `loadLlamadoConfig`, `loadSala`, la guía de primeros pasos y las lecturas de `createCategory`/`moveCategory`/`nextProductOrder`/`moveProduct` pedían «todo» sin paginar; PostgREST corta en 1000. `productsOfCategory` y `loadProductOptions` ya paginaban: **no se tocaron**. Las opciones y los grupos (tope técnico de 60 y 20) caben en una página y se leen igual con el helper.

**Decisión.** Paginación **por clave** (`readAllByKey`: `id` mayor que el último recibido, `order("id")`) en cada lectura de todo de esta tanda: una baja o un alta entre páginas no corre las siguientes ni repite filas (con `offset` sí, y se salta una fila sin error: hallazgo de la revisión, ronda 1). En `loadSala` el orden «más antiguo primero» lo pone `sortOldestFirst` al final, y las mesas de los llamados se piden de a 100 ids (la lista viaja en la URL). La posición nueva sale de una sola fila (`order sort_order desc limit 1`). Los topes del plan (platos y mesas **activos**) no se tocan: los inactivos no tienen tope y por eso una lista puede pasar de 1000 sin romper ningún límite comercial.

## 6. Reordenamientos atómicos
**Confirmado.** `applyOrder` hacía N `UPDATE` en `Promise.all`: un fallo del medio dejaba posiciones mezcladas, y la acción no vencía la caché pública cuando fallaba. Dos movimientos simultáneos calculaban sobre la misma lectura.

**Decisión.** `reorder_siblings` (migración nueva, `SECURITY INVOKER`): bloquea a los hermanos, comprueba que siguen como se leyeron (`55000 order_changed` si no), renumera y verifica que cada fila que debía cambiar cambió. `moveSibling` relee y recalcula hasta 5 veces. La caché se vence ante todo cambio confirmado **y** ante «no sé si se guardó» (`uncertain`: se perdió la respuesta de la base); no ante un fallo que la base revirtió entera.

## 7. Huérfanos por reemplazos concurrentes de fotos y logos
**Confirmado.** `setProductImage`/`setLogo` borraban «la referencia leída antes de subir»: con dos reemplazos a la vez la subida del primero que apuntaba quedaba huérfana. `removeProductImage`/`removeLogo` tenían la misma lectura vieja.

**Decisión.** `replace_product_image` y `replace_organization_logo` (`SECURITY INVOKER`) bloquean la fila, cambian la referencia (o la quitan) y **devuelven la saliente**; se borra exactamente esa ruta. Un fallo de limpieza no rompe la vigente y se informa como `filesComplete: false` (aviso en pantalla + registro de la ruta). Si no llega la respuesta de la base no se borra la subida (podría haberse aplicado): se mira el estado real y, si no se puede asegurar, se informa «no pudimos confirmar».

## 8. URL `blob:` de `PhotoForm`
**Confirmado.** Cada foto elegida creaba una URL que nunca se revocaba. **Decisión.** Una sola URL viva en una referencia: se revoca al elegir otra foto, al descartar, cuando deja de mostrarse (terminó la acción) y al desmontar; no se crea si el componente se desmontó mientras se reducía la foto. La reducción de imágenes no cambia. (`LogoForm` ya revocaba.)

## Aceptación
- [x] Las listas de más de 1000 filas (categorías, platos, mesas, llamados pendientes), mezclando activos e inactivos, se leen completas: toda fila que existe durante toda la lectura aparece una vez, también con bajas entre páginas; una fila creada o borrada a mitad de lectura puede o no estar en ESA lectura (la siguiente la trae; PostgREST no da una transacción única entre pedidos). Mover y crear en ellas usa la lista completa.
- [x] El tope comercial sigue contando solo activos; no depende del corte de la respuesta.
- [x] Un fallo en el medio de un reordenamiento no deja ninguna posición cambiada (disparador de prueba en una fila).
- [x] Dos movimientos que se cruzan quedan aplicados los dos (gancho determinista); cuatro simultáneos dejan posiciones únicas y contiguas; una transacción que bloquea a los hermanos hace esperar al movimiento.
- [x] Autorización y aislamiento: `anon` y otro local no cambian nada; en solo lectura es un error (no un éxito vacío); un orden que no es permutación o una tabla inválida se rechaza.
- [x] La caché pública se vence ante un cambio confirmado y ante uno incierto, y no ante un fallo revertido.
- [x] Reemplazos simultáneos de foto y de logo no dejan huérfanos ni borran la vigente ni una subida ajena; fallos entre subida, actualización y limpieza no rompen la vigente y no se informan como limpieza completa.
- [x] Las vistas previas `blob:` se liberan sin revocar la que se muestra.

## (C) Invariantes
1. Un reordenamiento cambia todas las posiciones o ninguna.
2. Lo que se renumera es exactamente lo que se leyó: si cambió, no se escribe (se relee).
3. Cada archivo saliente lo borra quien lo desplazó, por su ruta exacta; nadie borra la vigente ni una subida ajena.
4. Un fallo de limpieza o una respuesta perdida nunca deja el plato o el local apuntando a un archivo inexistente.
5. Las funciones nuevas no amplían permisos: manda la RLS de quien llama; `anon` no puede ejecutarlas.
6. Una lectura «de todo» nunca devuelve de menos sin error.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| Falla una escritura del reordenamiento | Todo revertido; error sin cambios; la caché no se toca. |
| Se pierde la respuesta del reordenamiento | «No pudimos confirmar»; la caché se vence igual; recargar muestra el orden real. |
| Otra persona movió a la vez | Se relee y se aplica sobre el estado nuevo; tras 5 intentos, aviso «cambió el orden». |
| Falla el borrado del archivo saliente | La imagen vigente no se toca; aviso «el archivo anterior no se pudo borrar» y la ruta queda en el registro para limpiarla a mano. |
| Se pierde la respuesta de la base al apuntar la imagen | Se mira el estado real: si apunta a la nueva, éxito con aviso de limpieza pendiente; si no se puede asegurar, no se borra nada y se informa «no pudimos confirmar» (puede quedar un archivo de más). |
| La cuenta pasa a solo lectura entre la subida y apuntar | No cambia la referencia; la subida no se puede borrar (Storage también bloquea) y queda registrada. |
| Migración mal aplicada | Rollback en la cabecera de `20261105100000_orden_e_imagenes_atomicos.sql`: **primero se despliega el código anterior** (el nuevo llama a las funciones) y recién después se retiran. |

## Alcance / fuera de alcance
Incluye: migración, `catalog.ts`, `options.ts`, `identity.ts`, `tables.ts`, `config.ts`, `pending.ts`, `primeros-pasos.ts`, acciones de carta y apariencia, `PhotoForm`, pruebas, ADR 0033. No incluye: barrido periódico de huérfanos; cambiar el modelo de posiciones; paginar listas acotadas por topes técnicos o comerciales (sucursales por plan en las pantallas que solo muestran las activas se paginaron igual por coherencia); `LogoForm` (ya revoca).

## Migración
`supabase/migrations/20261105100000_orden_e_imagenes_atomicos.sql`: tres funciones `SECURITY INVOKER` con `EXECUTE` para `authenticated` (no para `anon`). Aditiva, sin datos. **Staging no la tiene** (requiere aprobación).

## Evidencia
Local, 2026-10-21, sobre el árbol sin commitear de esta ficha (el commit probado se anota en «Revisión»), con `pnpm db:reset` y la migración nueva:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` **716/716** (nuevas: 9 en `carta-outcome.test.ts` —invalidación de la caché ante cambio confirmado, incierto y revertido, y aviso de limpieza incompleta—).
- `pnpm test:rls` completo **907/907** en 40 archivos. Nuevas: 16 en `listas-y-orden.rls.test.ts` (más de 1000 categorías, platos, mesas y llamados; mover y crear en listas largas; fallo del medio sin posiciones cambiadas; movimientos cruzados con gancho determinista, cuatro simultáneos, transacción que bloquea a los hermanos; `anon`, otro local, solo lectura, orden inválido, lectura vieja) y 16 en `reemplazo-de-imagenes.rls.test.ts` (reemplazos de foto y de logo simultáneos y con ganchos, quitar contra reemplazar, archivo ajeno que no se borra, rechazo de la base, respuesta perdida con y sin cambio aplicado, fallos de limpieza); `acl.rls.test.ts` ahora distingue las funciones `SECURITY INVOKER`. Se ajustaron 6 pruebas existentes al contrato nuevo (`filesComplete`, el cliente de prueba que reenviaba toda `rpc` como `org_entitlements`, el fallo de apuntar la imagen ahora por `rpc`).
- E2E (`--workers=1`, contra el build): `carta`, `opciones`, `mesas`, `llamado-config`, `sala`, `identidad`, `idiomas` y `desactivar-sucursales` **111/111**; nueva: las vistas previas `blob:` (elegir otra, descartar, guardar, salir de la pantalla; la que se muestra se ve y no se revoca).
- **Mutaciones** (restauradas): borrar la referencia leída antes en vez de la devuelta por la base (2 pruebas fallan), quitar la comprobación de «lo leído» del SQL (2), `loadCarta` sin paginar (1), `PhotoForm` anterior (el E2E ve 2 URL vivas en vez de 1).
- **Hallazgos durante la implementación:** (1) PostgREST **reintenta sin fin** los errores con SQLSTATE `40001`: `order_changed` usa `55000` (ADR 0033, decisión 6). (2) Con RLS un `UPDATE` filtrado afecta 0 filas sin error: la primera versión de `reorder_siblings` devolvía éxito en solo lectura; ahora lee desde el propio `FOR UPDATE` y verifica las filas cambiadas (lo detectó una prueba existente).
- **No probado / límites:** staging (la migración no está allí); más de 5 movimientos cruzados seguidos sobre la misma lista; limpieza de huérfanos que quedan por fallos de Storage (solo se registran); un teléfono real con la vista previa.

## Revisión y aprobación
- **Codex, ronda 1 (commit `bd52a08`, nivel C, esfuerzo high): APROBAR CON CAMBIOS, 2 hallazgos importantes, ambos confirmados.** (1) La paginación por `offset` se salta una fila sin error si hay una baja entre páginas (reproducido con el helper en memoria): pasó a paginación por clave, con pruebas del helper (baja y alta entre páginas) y las de integración de más de 1000 filas intactas. (2) La cabecera de rollback decía que bastaba retirar las funciones, pero el código nuevo depende de ellas: ahora exige desplegar primero el código anterior. Quedan fuera, por ser lecturas anteriores a esta tanda, las que siguen con `readAllPages` (carta pública, idiomas, sucursales, opciones de un plato, disponibilidad).
- **Codex, ronda 2 (verificación, commit `4ede39c`): APROBAR CON CAMBIOS, 1 hallazgo.** Rollback: corregido. Paginación: la omisión por bajas quedó corregida; persistía que una fila creada detrás del cursor a mitad de lectura no aparece en esa lectura. **Tolerancia acordada y documentada** (la propia revisión la admite como salida): ninguna lectura por HTTP puede ser una foto única, así que la garantía es «toda fila que existe durante toda la lectura aparece una vez»; el alta concurrente aparece en la lectura siguiente. Se corrigieron la promesa de la aceptación y la prueba, que ahora exige ambas cosas.
- **Codex, ronda 3 (verificación, commit `1f26da7`): APROBAR, sin hallazgos.** Paginación: corregida mediante la aclaración del contrato; rollback: corregido. Revisión estática: no ejecutó Vitest, RLS ni E2E (esa evidencia es la de arriba, sobre `bd52a08`; después solo cambiaron la paginación por clave —con 726 pruebas unitarias y 180 de RLS verdes— y documentación).
- Pendiente: la **aprobación humana** (no está dada) antes de subir a `origin`, aplicar la migración en staging o desplegar.
