# Cambio: El Dueño lee los pagos y el historial de cambios de su cuenta
Estado: revisado por Codex (2 rondas, aprobado); falta que el usuario lo pruebe y apruebe antes de integrarlo y de aplicar la migración a staging
Nivel: C (exposición de información —datos de dinero y de operaciones del equipo de UcoMenu hacia el cliente— y autorización: quién lee qué de la facturación)

## Objetivo
Que el **Dueño** de un local vea, en `/panel/{slug}/suscripcion`, (1) los **pagos** que UcoMenu registró para su cuenta y (2) el **historial de cambios de su cuenta** (alta, cambios de plan, suspensiones y reactivaciones, pagos registrados, Dueños sumados). Hoy solo lo ven los SuperAdmin y el Dueño tiene que preguntar («El Dueño no ve sus pagos ni la auditoría todavía», ficha `superadmin-planes-pagos`, A8; ADR 0013). El Staff no ve nada de esto (ADR 0006: el plan y los importes son del Dueño).

## Decisiones
- **Por funciones de base con una proyección segura, no por una política sobre las tablas.** `payments` y `audit_log` siguen cerradas a la API para el Dueño (solo SuperAdmin leen). Dos funciones `SECURITY DEFINER`, `owner_payments(p_org, p_limit, p_before)` y `owner_account_history(p_org, p_limit, p_before)`, devuelven **solo** los datos que el cliente puede ver, **solo si quien llama es Dueño actual de esa organización** (`private.is_org_owner`); si no, cero filas (igual que un local inexistente). Es el mismo patrón del historial de precios: la tabla no se abre, se entrega una vista acotada.
- **Qué ve de los pagos:** día en que se recibió, plan y ciclo de entonces, importe y moneda, medio, referencia, **cuándo se registró** y hasta cuándo cubre **con el vencimiento anterior** («cubre hasta el X (antes vencía el Y)»: no se afirma «desde» una fecha, porque un pago de una cuenta vencida no cubre el hueco). **No** ve quién lo registró (`registered_by`) ni ids internos de usuarios.
- **Qué ve del historial:** la fecha y un detalle **elegido acción por acción** (no el JSON): alta (plan, ciclo, vence); cambio de plan (de → a); suspensión; reactivación (estado resultante); pago (importe, medio, plan, período cubierto); Dueño sumado (si fue ascenso de alguien que ya era del local). El autor figura siempre como **«Equipo de UcoMenu»**: no se muestra el email de la persona.
- **Qué NO ve nunca:** `actor_id`, `actor_email`, el **motivo** escrito por el SuperAdmin (puede ser una nota interna), `owner_user_id` ni otros ids o emails de terceros, el `slug`/`name` de otras organizaciones (el detalle «en otros locales» de «Dueño sumado» queda afuera), ni el JSON crudo `before`/`after`.
- **Lista blanca de acciones:** solo las seis conocidas. Una acción nueva que se agregue a `audit_log` **no** se muestra al Dueño hasta que alguien la sume a propósito a la función.
- **Referencia del pago: se muestra** (es el número de operación de su propio pago, útil para conciliar). Si el usuario prefiere ocultarla, se quita de la función sin otro cambio.
- **Paginación acotada:** 24 pagos y 25 movimientos por pantalla, hasta 100 por pedido; «Ver más» pide los anteriores a un **cursor (fecha, id)** de la última fila mostrada (la fecha sola saltaba filas empatadas; hallazgo 1 de la ronda 1). Nada se escribe.
- **Sin cambios de esquema de las tablas ni de permisos sobre ellas.** Solo dos funciones nuevas (`authenticated`, no `anon`; `service_role` no las necesita).

## Aceptación
- [x] Un **Dueño** ve los pagos y el historial de **su** organización, del más nuevo al más viejo, con el detalle de arriba.
- [x] El **Staff** de ese local, el Dueño de **otro** local, un usuario sin rol, `anon` y un SuperAdmin sin membresía **no obtienen filas** (por la API y por la pantalla; el Staff no ve el enlace ni la sección).
- [x] La respuesta **no contiene** `registered_by`, `actor_id`, `actor_email`, motivos, `owner_user_id` ni datos de otras organizaciones (comprobado con una auditoría real que sí los guarda).
- [x] Una acción de auditoría desconocida no aparece.
- [x] Un Dueño al que se le quitó la membresía deja de ver todo al instante; con la cuenta suspendida o vencida **sigue** viendo su historial (es justo cuando lo necesita).
- [x] Los pagos y el historial de **otro** Dueño de la misma organización son los mismos (la cuenta es de la organización).
- [x] Paginación: «Ver más» trae los anteriores sin repetir ni saltar (incluso con filas de la misma fecha); un tope fuera de rango se acota.
- [x] Las tablas siguen sin política de lectura para el Dueño (`select` directo a `payments` y `audit_log` devuelve vacío) y sin escritura para nadie.
- [x] 390 px sin desborde; textos en español, importes con la moneda; sin datos: «Todavía no hay pagos registrados».

## Fuera de alcance
- Corregir un pago mal cargado, add-ons, desactivar organizaciones y el borrado de organizaciones (ítems aparte del tablero); recibos o facturas descargables; avisos por email; que el Staff vea algo.

## Evidencia
Ejecutado el 2026-10-18 sobre la rama `feat/dueno-lee-pagos-auditoria` (base local reseteada con la migración `20261026100000`):
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK.
- `pnpm test` **576/576** (nuevas: `src/lib/cuenta/lectura.test.ts`, 21: lectura defensiva de pagos e historial, cursor de «Ver más», el día del pago sin corrimiento horario, texto de cada acción y que las claves de más no se muestran).
- `pnpm test:rls` completo **694/694** (30 archivos). `owner-lectura.rls.test.ts` **12/12**: Dueño y segundo Dueño ven lo suyo, en orden; Staff, Dueño de otro local, sin rol, SuperAdmin sin membresía y SuperAdmin que hizo los cambios reciben cero filas y anon no puede ejecutar; organización inexistente o parámetro nulo, vacío; quitarle la membresía o pasarlo a Staff lo deja sin nada al instante; con la cuenta vencida 200 días y suspendida el Dueño sigue viendo; columnas exactas de la respuesta; **ni rastro** de `admin.id`, email del SuperAdmin, id y email del Dueño sumado, motivo interno, local ajeno donde trabaja el sumado (la auditoría real sí lo guarda), `registered_by`, `owner_user_id`; detalle por acción; un alta con `owner_user_id` y nombre interno solo muestra plan, ciclo y vencimiento; una acción fuera de la lista blanca (se permite temporalmente en la restricción y se restaura) no se muestra; paginación sin repetir ni saltar y tope 100; las tablas siguen cerradas (lectura vacía, insert denegado, update/delete sin efecto) y leer no cambia nada. `acl.rls.test.ts` **18/18** con las funciones registradas (`authenticated` sí, `anon` no).
- **Mutaciones sobre las funciones de base: 15 defensas rotas de a una, 15 detectadas** (sin comprobar al Dueño en pagos y en historial; miembro en vez de Dueño; sin filtro por organización en cada una; motivo en el detalle; email del actor; sin lista blanca de acciones; id de usuario en `owner.added` y en el alta; sin tope de filas; sin mínimo; sin filtro por fecha; orden invertido; `anon` con permiso de ejecución).
- `playwright test e2e/cuenta-pagos-historial.spec.ts --workers=1`: **4/4** (el Dueño ve pagos e historial sin el motivo ni el autor ni ids en el HTML, a 390 px sin desborde; sin movimientos, «Todavía no hay…»; el Staff no ve nada y el Dueño de otro local tampoco; 26 pagos paginan 24 + 2 sin repetir y un cursor inventado se ignora). Capturas a 390 y 1280 px revisadas.
- **Ronda 1 de Codex y correcciones (misma fecha, abajo):** `pnpm lint` y `typecheck` OK; `pnpm test` **576/576**; `pnpm test:rls` completo **695/695** (`owner-lectura` **13/13**, con la prueba nueva de 26 movimientos y 5 pagos con la MISMA fecha que se recorren por cursor sin repetir ni saltar, y el cursor viejo solo con fecha sigue siendo «estrictamente anterior»); `e2e/cuenta-pagos-historial.spec.ts` **4/4** (ahora también «antes vencía el» y «Registrado el»). **Mutaciones: 18 defensas rotas de a una, 18 detectadas** (las 15 anteriores más: pagos sin desempate por id, historial sin desempate por id, un cursor sin id que incluye las empatadas y pagos en orden ascendente; el primer intento se cortó por falta de memoria de la máquina y se repitió en tres tandas).
- **No ejecutado:** E2E completo (esta ficha toca solo la pantalla de Suscripción), aplicar la migración a staging (espera la revisión y tu aprobación), ver la pantalla con datos reales de un cliente.

## (C) Invariantes
1. Solo un **Dueño actual** de la organización recibe filas de ESA organización; cualquier otra identidad, cero filas, sin distinguir «no existe» de «no es tuyo».
2. Las funciones **solo leen**: `payments` y `audit_log` siguen de solo-agregado y cerradas a la API para el Dueño.
3. La salida es una **lista blanca**: ningún dato de personas del equipo de UcoMenu ni de terceros, ni notas internas, ni otras organizaciones.
4. Una acción de auditoría nueva queda **oculta** hasta que se la incluya a propósito.
5. Leer no cambia el estado de la cuenta ni bloquea nada: un fallo de lectura solo vacía esa sección.

## (C) Fallos y recuperación
- **La función falla o la base no responde:** la pantalla de Suscripción sigue mostrando el plan y el estado y, en cada sección, «No pudimos leer … Probá de nuevo»; no se muestra nada a medias.
- **Rollback:** `git revert` y, en una base con datos, `drop function public.owner_payments(uuid, integer, timestamptz, uuid), public.owner_account_history(uuid, integer, timestamptz, uuid);` (no hay datos propios que perder).
- **Un detalle nuevo mal armado** (clave ausente en `before`/`after` de filas viejas): la función usa `->` con `jsonb_strip_nulls`, así que una clave ausente se omite y la pantalla muestra solo lo que haya.

## (C) Revisión y aprobación
- **Ronda 1 (Codex, `--commit HEAD` sobre `36b3da0`, solo lectura): APROBAR CON CAMBIOS, 2 hallazgos «importantes», los dos reales y corregidos:**
  1. *La paginación omitía filas con la misma fecha* (ordenaba por fecha e id pero el cursor llevaba solo la fecha). Ahora el cursor es (fecha, id) en las dos funciones (`p_before_id`), la dirección y la pantalla. Regresión: prueba RLS con fechas idénticas (falla sin el desempate: 2 mutaciones lo detectan).
  2. *La pantalla no mostraba cuándo se registró el pago ni el vencimiento anterior* (la ficha lo prometía). Ahora: «Cubre hasta el X (antes vencía el Y)» y «Registrado el …»; se evitó «desde» porque un pago de una cuenta vencida no cubre el hueco.
- **Ronda 2 (verificación, Codex sobre `4ed2f28`): APROBAR.** Los dos hallazgos, corregidos (revisó la regresión de fechas empatadas y la lectura de los datos nuevos). Una sugerencia no bloqueante, aplicada: el comando de rollback de esta ficha tenía las firmas de tres argumentos y ahora son cuatro.
- Aprobación del usuario antes de aplicar la migración a staging: pendiente.
