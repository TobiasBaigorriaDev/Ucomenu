# Cambio: Borrar categorías y platos (con la limpieza de sus fotos en Storage)
Estado: **para verificar** — implementado y probado en local; falta la revisión independiente y la aprobación humana
Nivel: C (eliminación irreversible de datos de un cliente: platos con precios, variantes, adicionales, disponibilidad y archivos de Storage)

## Objetivo
Hoy categorías y platos solo se desactivan ([gestión de carta](gestion-de-carta.md), decisión 7). Que el Dueño y el Staff puedan **borrarlos de verdad** desde el panel, sin dejar archivos huérfanos en `product-images`. Borrar una categoría arrastra a sus platos (clave foránea compuesta con `ON DELETE CASCADE`), y con ellos sus variantes y adicionales, su disponibilidad por sucursal, sus traducciones (columnas) y los contadores de vistas.

## Decisiones
1. **Quién:** Dueño y Staff, como ya dice la RLS de `DELETE` (`is_org_member` + `org_can_write`) y `producto.md` (el Staff mantiene platos). No se cambia ningún permiso ni hay migración: la autoridad de fondo es la que ya existe y está probada. Si el usuario prefiere que solo el Dueño pueda borrar categorías con platos, es una política nueva (se pregunta al cerrar).
2. **Con el cliente de la persona (RLS)**, nunca `service_role`. Un `DELETE` bloqueado afecta 0 filas sin error: se pide `.select("id")` y 0 filas = fallo con su causa (misma regla que el resto del módulo).
3. **Storage después de la base** (igual que [ADR 0028](../../docs/decisiones/0028-borrado-definitivo-de-organizaciones.md)): primero se borra la fila y, **recién con el borrado confirmado**, se limpian `product-images/{org}/{plato}/…` (la ruta guardada y cualquier archivo suelto de esa carpeta). Nunca lanza: si falla, el plato/categoría ya no existe, se registra en el log del servidor con la organización y el plato, y la pantalla avisa «algunas fotos no se pudieron limpiar».
4. **Confirmación en dos pasos, validada en el servidor:**
   - *Plato:* sección «Borrar plato» en su pantalla de edición; el botón abre la explicación y recién ahí se confirma.
   - *Categoría:* en su cabecera. El servidor lee los platos de **esa** categoría: si la cantidad que la persona vio (`expected`) no coincide con la real → «La categoría cambió, revisala», no borra. Si tiene platos, además hay que **escribir el nombre exacto** de la categoría (el servidor lo compara). Sin platos alcanza el segundo paso.
5. **Qué se conserva:** `price_history` sigue con el `product_id` huérfano (ADR 0012: la pantalla ya muestra «Plato eliminado»); se limpia recién al borrar la organización (ADR 0026).
6. **Qué se pierde, y se dice en pantalla:** variantes y adicionales, disponibilidad por sucursal, traducciones y las vistas contadas de esos platos (analítica). Desactivar sigue siendo la baja reversible y la pantalla lo recuerda.
7. **Cuenta bloqueada:** en solo lectura y suspendida no se borra (`blocked_*`, como el resto de las escrituras de catálogo, `producto.md`).
8. **Tras borrar:** se redirige a la carta con el aviso («Plato borrado», «Categoría borrada con N platos»). El caché de la carta pública se vence en el acto (`refresh`).

## Aceptación
- [x] Dueño y Staff borran un plato: desaparece de la carta del panel y de la pública, y con él su foto, sus variantes, adicionales y disponibilidad; el historial de precios queda y lo muestra como «Plato eliminado».
- [x] Borrar una categoría con platos exige escribir su nombre; borra la categoría, todos sus platos y **todos** sus archivos de Storage (no los de otras categorías ni de otra organización).
- [x] Una categoría sin platos se borra con la confirmación simple.
- [x] Si la categoría cambió entre que se mostró y se confirmó (otro plato agregado o borrado), no se borra nada.
- [x] Un id de otra organización (URL o campo oculto) responde «no encontrado» y no borra nada ni toca sus archivos.
- [x] En solo lectura y suspendida ninguna de las dos acciones borra (Dueño y Staff), ni siquiera con la comprobación del estado desactualizada.
- [x] Si Storage falla (error o cero objetos), la fila ya está borrada, se avisa en pantalla y queda en el log con los ids; nunca se informa un éxito sin aviso.
- [x] Tope del plan: borrar un plato activo libera cupo.
- [x] A 390 px, sin desborde; objetivos táctiles de 44 px; el borrado accidental con un solo toque no existe.

## Alcance / fuera de alcance
- Incluye: funciones `deleteProduct` y `deleteCategory` en `src/lib/carta/catalog.ts` con limpieza de Storage, dos server actions, formularios de confirmación, aviso en la carta, pruebas unitarias/RLS/E2E, `producto.md`, ADR 0029 corto y tablero/handoff.
- No incluye: borrar variantes/adicionales por separado, mesas ni sucursales; «papelera» o deshacer; borrado en lote; limpieza automática de huérfanos viejos; cambiar quién puede borrar.

## (C) Invariantes
1. Solo un miembro con la cuenta al día borra, y solo dentro de su organización (RLS + `organization_id` en cada consulta).
2. No se borra nada que la persona no haya visto: el conteo de platos de la categoría tiene que coincidir y, si hay platos, el nombre escrito también (verificado en el servidor, no en el navegador).
3. Los archivos de Storage se tocan **solo después** de que la fila se borró (un borrado fallido nunca deja un plato sin foto).
4. Solo se borran archivos de la carpeta `{org}/{plato}/` de platos que se acaban de borrar.
5. Un `DELETE` o un `remove` descartado por RLS (0 filas / 0 objetos) nunca se informa como éxito completo.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| La base rechaza o la cuenta está bloqueada | No se borra nada ni se toca Storage. Mensaje con el motivo. |
| La categoría cambió | No se borra nada; «recargá y volvé a mirar». |
| Storage falla después de borrar | La fila ya no existe; aviso en pantalla y log con ids; limpieza manual de `product-images/{org}/{plato}`. |
| Se corta el servidor entre la base y Storage | Archivos sueltos sin aviso, inofensivos (la carta no los enlaza; el bucket es público pero la URL lleva uuid). Riesgo aceptado, igual que ADR 0028. |
| Borrado por error | **No se recupera**: solo el respaldo (`pnpm respaldo`, `docs/operacion.md`). Por eso: dos pasos, nombre escrito si hay platos, y «Desactivar» como alternativa a la vista. |
| Dos personas a la vez | Gana el primero; el segundo recibe «no encontrado». |

## Riesgos
- **Permiso amplio:** el Staff puede borrar una categoría entera. Se compensa con la confirmación escrita; queda a decisión del usuario si debe ser solo del Dueño.
- **Ventana de milisegundos:** un plato creado en esa categoría entre la lectura y el `DELETE` se borra sin haberse visto (no puede tener foto aún). Aceptado.
- Las estadísticas de vistas de los platos borrados se pierden (contadores sin identificación, ADR 0022).

## Evidencia
Local, 2026-10-21, sobre el árbol sin commitear de esta ficha (el commit probado se anota en «Revisión»); sin cambios de esquema, así que no se reseteó la base:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` **680/680**.
- `pnpm test:rls tests/rls/carta.rls.test.ts` **27/27** (10 nuevas: plato con foto, archivo suelto, opciones y historial; cupo liberado; categoría con platos —cantidad, nombre y otra categoría intacta—; vacía; otra organización y persona ajena; solo lectura y suspendida con el estado desactualizado; gracia; Storage con cero objetos, error y sin poder listar; Storage intacto si el `DELETE` no se concreta).
- E2E (`--workers=1`, contra el build): `carta.spec.ts` + `historial-precios`, `opciones`, `disponibilidad`, `idiomas` y `rendimiento-carta` **59/59** (6 nuevas de borrado: plato en dos pasos con su foto y la carta pública, categoría con nombre equivocado y correcto, vacía, categoría que cambió, Staff, solo lectura de Dueño y Staff con acción forzada; sin desborde a 390 px). Un primer intento falló por mis propios cambios (una etiqueta nueva chocaba con `getByLabel("Nombre de la categoría")` de pruebas existentes; el `summary` no es `button` para Playwright): corregido en la etiqueta y en los localizadores.
- **Mutaciones** (de a una sobre `catalog.ts`, restauradas): 10 probadas, **10 detectadas** — sin chequear 0 filas (plato y categoría), sin comparar la cantidad, sin comparar el nombre, sin limpiar la carpeta (solo la ruta guardada), sin limpiar las fotos de la categoría, sin registrar el «cero objetos», sin `guard`, Storage limpiado antes del `DELETE`, categoría sin acotar a la organización.
- **No probado / límites:** suite RLS y E2E completas (no se tocó el esquema ni otras pantallas); Storage real de Supabase hosted (solo el local); teléfono real y lector de pantalla; ventana entre la lectura y el `DELETE` de la categoría (aceptada); corte del servidor entre la base y Storage (aceptado); borrado con muchos cientos de platos.

## Revisión y aprobación
_(pendiente: revisión independiente de Codex y aprobación humana antes de integrar/desplegar)_
