# Cambio: Pantalla del historial de promociones
Estado: **implementado y verificado en local (2026-10-23).** Quinta y última pieza de S2 ([ADR 0040](../../docs/decisiones/0040-promociones-programadas.md), decisión 7). Lee el `promotion_history` de la [ficha C](promociones-y-precio-efectivo.md); se abre desde el [panel](panel-de-promociones.md).
Nivel: **S** — solo lectura, sin cambios de datos ni de permisos (la RLS que ya tenía la tabla). Sin ficha obligatoria; esta es breve por trazabilidad.

## Qué es
`/panel/{slug}/promociones/historial`: cada alta, cambio y baja de una promoción, y cada plato, categoría o sucursal que entra o sale, del más nuevo al más viejo, de a 50 con «Ver más» (cursor por instante e id, estable aunque entren cambios mientras se pagina). Dueño y Staff; se abre aunque la cuenta esté en solo lectura o suspendida.

## Decisiones
1. **Nombre de la promoción**: sale de su constancia más reciente de alta, cambio o baja (el historial no tiene clave foránea a la promoción: sobrevive a su borrado y conserva el nombre que tenía).
2. **Detalle en palabras**: alta y cambio dicen el descuento, los días, el horario, las fechas y si quedó pausada; la baja dice además cuántos platos o categorías y sucursales tenía; un plato, una categoría o una sucursal se nombran por su nombre actual, o «plato eliminado», «categoría eliminada», «sucursal desactivada o eliminada».
3. **Quién**: la misma regla que el historial de precios: el Dueño ve el email de quien sigue en el local (y «Vos» para sí), el Staff nunca ve emails («Otra persona del equipo»), quien ya no está figura como «Persona que ya no está en el local» y una operación sin persona, «Operación técnica». Si no se pueden resolver, etiqueta neutra y un aviso.
4. **Un error de lectura se muestra como error**, nunca como «todavía no hay promociones».
5. La hora se muestra en la zona de Argentina (igual que el historial de precios): el registro es del local entero, no de una sucursal.

## Aceptación
- [x] Muestra las siete clases de evento con su detalle; la baja de una promoción deja una sola línea con lo que tenía.
- [x] Pagina de a 50 sin repetir ni saltear (probado con 56 constancias).
- [x] El Staff lo ve sin emails; otra organización y `anon` no ven nada (`anon` da error, no una lista vacía).
- [x] Una promoción borrada conserva su nombre.

## Evidencia
RLS `panel-promociones` («el historial se lee con la RLS»: dos páginas, nombres, detalle, otra organización, `anon`, borrada), unitarias `carta.test` («el historial en palabras») y E2E `promociones` (Dueño: «Se borró…», «Tenía 1 plato o categoría», «Vos»; Staff: «Operación técnica»), todo en verde junto con la suite completa de RLS (1276/1276).
