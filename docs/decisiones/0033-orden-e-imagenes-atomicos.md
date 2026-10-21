# 0033 — Los reordenamientos y los reemplazos de imagen son una sola llamada a la base (funciones `SECURITY INVOKER`); las listas se leen por páginas

- Estado: aceptada (aprobada por el usuario y desplegada en staging el 2026-10-21)
- Fecha: 2026-10-21

## Contexto
Cuatro defectos de la gestión de la carta, confirmados contra el código:

1. **Listas truncadas sin aviso.** PostgREST corta cada lectura en `max_rows` (1000) sin error. `loadCarta`, `loadMesas`, `loadLlamadoConfig`, `loadSala`, la guía de primeros pasos y las lecturas con las que se calculan y reordenan posiciones recibían la primera página y seguían: una carta con más de 1000 categorías o platos (los **inactivos no tienen tope**) mostraba de menos, y mover o crear con una lista cortada renumeraba con datos incompletos.
2. **Reordenamiento no atómico.** `applyOrder` lanzaba N `UPDATE` en paralelo: si uno fallaba quedaban posiciones mezcladas y, como la acción no invalidaba la caché en un fallo, la carta pública podía quedar vieja respecto de lo ya escrito. Dos personas moviendo a la vez calculaban sobre la misma lectura y la última pisaba a la primera.
3. **Huérfanos por reemplazos concurrentes.** `setProductImage` y `setLogo` leían la foto anterior, subían, apuntaban y borraban «la que leyeron». Con dos reemplazos simultáneos ambos borraban la misma anterior y la subida del que apuntó primero quedaba sin referencia ni dueño.
4. **Vistas previas `blob:` sin liberar** en `PhotoForm`.

## Decisión
1. **Lectura por páginas, por clave.** Las lecturas «de todo» de esta tanda usan `readAllByKey`: cada página pide las filas con `id` mayor que la última recibida (`order("id")`). Con `offset` (`readAllPages`), una baja entre dos páginas corre las siguientes y salta una fila sin error (lo reprodujo la revisión de Codex); por clave no. Para la posición siguiente alcanza una fila (`order sort_order desc limit 1`). El **tope comercial** (platos activos, mesas activas por sucursal) no cambia: sigue contando solo lo activo y no tiene relación con el corte de la respuesta. Las lecturas anteriores que siguen usando `readAllPages` (carta pública, panel de idiomas, sucursales, opciones de un plato, disponibilidad) conservan esa tolerancia hasta que se las migre.
2. **`reorder_siblings`** (`SECURITY INVOKER`): bloquea a todos los hermanos (`FOR UPDATE`, por id), exige que sean exactamente los leídos (ids y posiciones) y renumera en una transacción, verificando que cada fila que debía cambiar cambió. Si otro movimiento se coló responde `55000 order_changed` y el servidor **vuelve a leer y a calcular** (hasta 5 intentos): dos movimientos simultáneos quedan aplicados uno detrás del otro.
3. **`replace_product_image` / `replace_organization_logo`** (`SECURITY INVOKER`): cambian (o quitan, con `NULL`) la referencia bloqueando la fila y **devuelven la referencia saliente tal como estaba**. Quien limpia borra exactamente esa ruta. Nada borra «todo lo que no sea la vigente».
4. **`SECURITY INVOKER`, no `DEFINER`**: las tres corren con los permisos y la RLS de quien llama; no amplían ningún permiso, y el aislamiento entre locales y el estado de la cuenta siguen decidiéndolos las políticas de siempre. Los `GRANT` por columna ya existían.
5. **Fallos de limpieza y respuestas inciertas.** Un fallo al borrar el archivo saliente no toca la imagen vigente y se informa como limpieza incompleta (`filesComplete: false`, con aviso en pantalla y registro de la ruta). Si se pierde la respuesta de la base (error sin SQLSTATE) **no se borra nada**: se mira el estado real y, si no se puede asegurar, se informa «no pudimos confirmar» y se vence la caché igual (el cambio pudo haberse aplicado).
6. **`55000`, no `40001`.** PostgREST reintenta por su cuenta los errores `40001` (serialization_failure); como el estado no cambia, el pedido queda reintentándose sin fin (se vio colgado). `order_changed` usa `55000`, como `account_changed` (ADR 0032).
7. `PhotoForm` guarda la única URL `blob:` viva en una referencia y la revoca al elegir otra foto, descartarla, cuando deja de mostrarse (la acción terminó) y al desmontar; nunca mientras se muestra.

## Alternativas consideradas
- **`SECURITY DEFINER` con la autorización reescrita adentro** — duplica la RLS y es justo lo que el repositorio evita para escrituras de catálogo.
- **Mantener los `UPDATE` sueltos y compensar** (deshacer a mano) — la compensación también puede fallar y no cierra la carrera.
- **Posiciones fraccionarias o listas enlazadas** (mover = una sola fila) — cambia el modelo de datos, la carta pública y las pruebas; fuera de alcance.
- **Borrar todo archivo de la carpeta distinto del vigente** — borra la subida simultánea de otra pestaña.
- **Un barrido periódico de huérfanos** — útil como red de seguridad, pero no reemplaza cerrar la carrera; queda como idea futura (la ruta de cada huérfano ya queda en el registro).

## Consecuencias
- Un movimiento tiene un costo constante de una llamada a la base (más la lectura); la lista de hermanos viaja en la llamada (cientos de KB en el peor caso de miles de elementos).
- Un archivo puede quedar sin borrar si Storage falla o la cuenta se bloquea justo en el medio (registrado; no afecta lo que se ve). Una respuesta perdida puede dejar la subida nueva sin referencia: se prefiere un archivo de más a una foto rota.
- Cinco intentos seguidos de «otra persona cambió el orden» son prácticamente imposibles con personas; se informa el error y se pide mirar y repetir.
- Migración nueva y aditiva (`20261105100000_orden_e_imagenes_atomicos.sql`); el rollback exige **desplegar primero el código anterior** (el nuevo llama a las funciones) y recién después retirarlas; está en su cabecera. Staging no la tiene.
