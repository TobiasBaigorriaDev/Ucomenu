# Cambio: Reservas de mesa (fase 1: reservas manuales y asignación de mesa)
Estado: fase 1 implementada y verificada en local; en revisión independiente (nivel C) · [ADR 0051](../../docs/decisiones/0051-reservas.md)
Nivel: **C** (datos personales de comensales: nombre, teléfono y email; los lee solo el personal de la organización)

## Objetivo
Que el personal cargue, vea y gestione las reservas de cada sucursal desde la Sala, y le asigne una mesa. Es la base de la reserva
pública (fases 2 y 3, abajo), que reutiliza el mismo modelo, los mismos estados y la misma pantalla.

## Fases
1. **Esta ficha:** modelo de datos, funciones, pantalla «Reservas» (Sala), reserva manual, asignar mesa, cancelar, «no vino», sentar,
   purga a los 30 días, función `reservations` en Pro y Premium. Sin público, sin email.
2. Formulario público en la carta (botón flotante solo en `/m/…`), confirmación del email, límites contra spam, aviso push al personal
   y política de privacidad. Requiere contratar el proveedor de correo.
3. Disponibilidad automática, recordatorios y cancelación desde el email.

## Decisiones de la fase 1
- **Migración `20261215100000`:** tabla `reservations`, función `reservations` en `plans.features` (Pro y Premium) y en lo que informa
  `org_entitlements`, funciones de escritura y purga. Aditiva.
- **Quién escribe:** `create_reservation`, `assign_reservation_table`, `set_reservation_status` (todas `SECURITY DEFINER`, con
  `search_path` vacío). Pueden usarlas Dueño y Staff con `reservations` en el plan y la cuenta al día (`has_feature` ya excluye solo
  lectura y suspendida). El cocinero no; un anónimo no. Nadie escribe la tabla por la API, ni `service_role`.
- **Quién lee:** Dueño y Staff de la organización (política `is_org_member`). Las pantallas filtran por las sucursales asignadas del
  Staff (solo pantalla, como Mesas; ficha personal-por-sucursal).
- **Fecha y hora:** se mandan como fecha y hora **locales de la sucursal**; la base las convierte con la zona de la sucursal (ADR 0040).
- **Sin mesa doble:** `assign_reservation_table` y `set_reservation_status` serializan por mesa (`pg_advisory_xact_lock`) y rechazan
  (`table_busy`) una reserva `confirmed`/`seated` que se superponga con otra de la misma mesa. Una reserva dura 90 minutos por defecto
  (30 a 360); el horario de fin se guarda.
- **Reintentos:** `create_reservation` recibe una `client_key` (uuid); repetirla con los mismos datos devuelve la misma reserva.
- **Transiciones permitidas:** `requested` → `confirmed` (con mesa) / `cancelled` / `rejected`; `confirmed` → `seated` / `cancelled` /
  `no_show` / `requested` (soltar la mesa); `seated`, `cancelled`, `rejected` y `no_show` son finales. `no_show` solo desde la hora de
  inicio en adelante.
- **Datos:** nombre (1–80), teléfono (6–30 caracteres, solo dígitos, espacios y `+ - ( )`), email opcional en la manual (≤ 120, forma
  básica), personas 1–50, nota ≤ 300 (la pantalla avisa que no se cargan datos sensibles). Reservas hasta 365 días adelante; no en el
  pasado (con 1 hora de margen).
- **Retención:** `purge_expired_reservations(p_retention interval default 30 days, p_batch)`, solo `service_role`, por lotes, sobre el fin
  de la reserva (o su creación si nunca llegó a tener fecha vigente). La programa quien despliega (`docs/produccion.md`).
- **Pantalla `/sala/{slug}/reservas`:** día elegido (hoy por defecto, con anterior/siguiente), lista por hora con nombre, personas,
  teléfono (enlace `tel:`), nota, estado y mesa; acciones «Asignar mesa», «Cancelar», «No vino», «Sentar»; formulario «Nueva reserva».
  Sin la función en el plan dice que está incluida desde Pro. Enlace «Reservas» en la Sala y en el panel; el Resumen suma
  «N reservas por confirmar» a «Para atender».

## Invariantes (para la revisión)
1. Un anónimo y el cocinero no leen ni escriben `reservations`; un miembro de otra organización, tampoco.
2. Ninguna reserva apunta a una sucursal o mesa de otra organización (claves compuestas).
3. Sin la función en el plan, o con la cuenta en solo lectura o suspendida, no se crea ni se cambia nada.
4. Una mesa nunca tiene dos reservas `confirmed`/`seated` superpuestas, ni con dos asignaciones a la vez.
5. Una reserva terminada (`cancelled`, `rejected`, `no_show`, `seated`) no vuelve a otro estado; los datos personales no sobreviven a la
   purga.
6. Borrar la organización o la mesa no deja reservas huérfanas ni rotas (cascada y `set null` con la etiqueta copiada).

## Aceptación
- [x] Dueño y Staff de un local Pro cargan una reserva, la ven en su día, le asignan una mesa libre y la cancelan, marcan «no vino» o
  la sientan.
- [x] Asignar una mesa ocupada a esa hora se rechaza con un mensaje claro; las mesas ocupadas no se ofrecen.
- [x] Un local Básico ve que la función viene con Pro; el cocinero y un anónimo no entran.
- [x] La hora se interpreta en la zona de la sucursal; dos sucursales no mezclan sus reservas.
- [x] 390 px sin desborde; teléfono con enlace `tel:`.
- [x] La purga borra lo vencido y respeta lo vigente.

## Fuera de alcance (fase 1)
Formulario público, email, push de aviso, política de privacidad, disponibilidad automática, edición de una reserva (se cancela y se
vuelve a cargar), recordatorios, reservas recurrentes o de grupos con varias mesas.

## Evidencia
(2026-10-31)
- `pnpm typecheck` y `pnpm lint` (solo un aviso ajeno en `video/`), `pnpm build` correctos. `pnpm test`: **1361/1361** (nuevas: `src/lib/reservas/reservas.test.ts`, 15).
- **RLS** `tests/rls/reservas.rls.test.ts`: **24/24** (rol, plan y mora; nadie escribe por la API ni `service_role`; hora local de Madrid frente a Buenos Aires; reintento con `client_key` y envíos simultáneos; mesa doble y asignación simultánea; transiciones; purga; claves compuestas entre organizaciones). Con `acl` y `billing` (listas exactas de funciones y de features actualizadas) y `vistas-previas`, `portada-planes`, `planes-pagos`, `limits`, `rol-cocinero`, `personal-por-sucursal`: **todo en verde**. No se corrió la suite RLS completa de una vez: se colgó dos veces compitiendo con otra corrida y las fallas conocidas de la base local (`catalog`, `carta`, `tenancy`, `push`) vienen de los datos de demostración.
- **E2E** `e2e/reservas.spec.ts` (5/5) a 390 px: cargar, asignar mesa, la ocupada no se ofrece, cancelar y liberar, dato inválido, Resumen con «1 reserva espera», Básico, cocinero y anónimo. Con `acceso`, `sala`, `sala-mesas` (se actualizó la lista de enlaces de la Sala), `personal-por-sucursal`, `panel-llamados-aviso`, `alta-guiada`, `sucursales` y `resumen-panel`: sin fallas propias (`sala.spec.ts:327` falla a veces bajo carga y pasa al repetirlo).
- **Hallazgo de la propia implementación** (corregido con prueba de regresión): cancelar una reserva confirmada violaba `reservations_table_check` porque conservaba la mesa; ahora se suelta la mesa y se conserva su etiqueta.
- Visto en pantalla (Aurelia, escritorio y 390 px): lista por hora, tarjetas con estado en texto, mesas libres, confirmación en dos pasos.
- **No ejecutado:** revisión en un teléfono real; la purga programada con `pg_cron` (está documentada en `docs/produccion.md`, 4.d); nada en staging.
- Recuperación: el rollback de la migración está en su encabezado.

## Revisión y aprobación
(pendiente: una ronda de Codex y tu aprobación antes de subir a staging)
