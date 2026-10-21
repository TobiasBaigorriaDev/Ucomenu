# 0026 — El historial de precios se purga solo al borrar la organización, tras 30 días de baja, por una función que nadie de la API ejecuta

- Estado: aceptada (política elegida por el usuario el 2026-10-20: se purga con la organización, baja previa de 30 días y confirmación con el slug; mecanismo: función de base dedicada; alcance: solo `price_history`)
- Fecha: 2026-10-20

## Contexto
El ADR 0012 dejó `price_history` como un registro de solo agregado (ni la API, ni `service_role`, ni el dueño de la tabla pueden tocarlo) y con `ON DELETE RESTRICT` hacia la organización, a propósito: una organización con historial no se puede borrar hasta decidir una retención. El borrado definitivo de organizaciones en SuperAdmin (tablero, nivel C) está bloqueado por eso. Falta decidir **cuánto se conserva, cuándo se purga y cómo se apaga la protección sin dejarla apagada**. Es eliminación irreversible de un registro de auditoría de precios que además trae ids de personas (`changed_by`).

## Decisión
1. **Retención.** Mientras la organización exista, su historial se conserva entero: no hay purga por antigüedad (es una fila por cambio de precio y casi no pesa). **Al borrar la organización, su historial se purga en la misma transacción.** No se archiva ni se exporta: después del borrado nadie podría leerlo (la RLS es de miembros) y no hay un dueño a quien deba entregarse.
2. **Condiciones.** Solo se purga una organización **dada de baja (`is_active = false`) hace 30 días o más**, comprobado en `audit_log` (el último evento de ciclo de vida de esa organización tiene que ser `organization.deactivated`, de hace 30 días o más). `is_active = false` puesto a mano, una reactivación posterior o una baja más reciente impiden la purga. La baja es reversible y el borrado no: los 30 días son el margen para arrepentirse.
3. **Mecanismo.** `private.purge_organization_price_history(p_org)`: `SECURITY DEFINER` de `postgres` (dueño de la tabla, único que puede apagar el trigger), `search_path` vacío. En una transacción toma el lock de la organización (`FOR NO KEY UPDATE`, el mismo de la baja y la reactivación, así que se serializan), comprueba las condiciones, apaga `price_history_no_update_delete`, borra las filas de esa organización, lo vuelve a encender y devuelve cuántas borró. Como `ALTER TABLE … DISABLE TRIGGER` es transaccional, si algo falla después o el llamador revierte, el trigger queda encendido y las filas siguen. El trigger de `TRUNCATE` no se toca.
4. **Quién la ejecuta.** **Ningún rol de la API**: ni `anon`, ni `authenticated`, ni `service_role`, ni `public` (se revocó a los cuatro y una prueba lo comprueba). Solo la llamará la función de borrado de organizaciones (ítem del tablero), que además tendrá que exigir: SuperAdmin recomprobado, **el slug escrito**, motivo (1 a 200) y la auditoría `organization.deleted` (con la cantidad de filas purgadas) en la misma transacción. Esa parte no se implementa acá.
5. **Errores estables:** `organization_not_found`, `organization_still_active`, `deactivation_not_audited`, `deactivation_too_recent`.

## Alternativas consideradas
- **`ON DELETE CASCADE` desde la organización** — el historial desaparecería con un borrado sin ninguna de las condiciones anteriores; descartado en el ADR 0012 y sigue descartado. La purga explícita deja las condiciones en un solo lugar.
- **Conservar el historial un plazo tras el borrado** (tabla de archivo o clave foránea suelta) — deja datos con ids de personas de una cuenta que ya no existe, sin lector ni finalidad.
- **Exportar a un archivo antes de purgar** — sirve si hubiera que entregárselo al cliente; no se pidió y agrega un archivo con datos personales fuera de la base.
- **Procedimiento manual con `psql`** — sin prueba automática ni auditoría atómica; depende de que quien lo corre no olvide volver a encender el trigger.
- **Una bandera de sesión que el trigger respete** (`set_config`) — cualquiera con SQL la activaría sin dejar rastro; apagar el trigger dentro de una función solo para `postgres` es una barrera más fuerte.
- **Purgar también `payments` y `payment_voids`** — son registros de cobro propios de UcoMenu y tienen su propio tema de conservación (contable y legal). Se deciden en el ítem de borrado de organizaciones.

## Consecuencias
- **Todavía no se puede borrar una organización:** `payments` y `payment_voids` siguen con `RESTRICT` y la función de borrado no existe. Este ADR cierra la parte de `price_history`; el ítem del tablero sigue bloqueado por la retención de los pagos.
- **La función sola no es una acción de usuario:** llamada aparte deja a la organización dada de baja sin historial y todavía reactivable (perdería el historial sin perder la organización). Por eso no se expone y solo debe llamarla el borrado, en la misma transacción que el `DELETE` de la organización.
- **Filas posteriores.** Si el servicio técnico (`service_role`, `psql`) cambia un precio de esa organización después de la purga, se genera una fila nueva; la función es idempotente y el borrado la llama dentro de su transacción antes de borrar, así que no queda ninguna.
- **Bloqueo breve.** Apagar el trigger toma `SHARE ROW EXCLUSIVE` sobre `price_history`: los cambios de precio de cualquier organización esperan a que termine (milisegundos con este volumen). No hay `lock_timeout`; si el historial creciera mucho, convendría acotarlo.
- **Riesgo residual (heredado del ADR 0012):** quien tenga la base como `postgres` puede apagar el trigger por su cuenta. Es por diseño; esta función no lo amplía, porque solo borra las filas de una organización que cumple las condiciones.
- **Irreversible y sin respaldo propio:** una vez confirmada la transacción, las filas no vuelven. El respaldo diario de `docs/operacion.md` es lo único que las conserva; el borrado de organizaciones debería recordarle al SuperAdmin que lo corra antes (no se hizo condición).
- La limpieza de las pruebas (`tests/rls/purge-price-history.ts`) sigue apagando el trigger por su cuenta contra el Docker local: es otra cosa y no usa esta función.
