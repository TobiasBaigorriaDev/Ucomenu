# Cambio: Reservas de mesa (fase 1: reservas manuales y asignación de mesa)
Estado: fase 1 implementada y verificada en local, revisada y aprobada por Codex (3 rondas, `c7b51f5`); en `origin/main` y en staging (Fly v88) · [ADR 0051](../../docs/decisiones/0051-reservas.md)
Nivel: **C** (datos personales de comensales: nombre, teléfono y email; los lee solo el personal de la organización)

## Objetivo
Que el personal cargue, vea y gestione las reservas de cada sucursal desde la Sala, y le asigne una mesa. Es la base de la reserva
pública (fases 2 y 3, abajo), que reutiliza el mismo modelo, los mismos estados y la misma pantalla.

## Fases
**Estado (2026-10-31):** la fase 1 está hecha y en staging; las fases 2 y 3 se pospusieron por decisión del usuario y quedan en el tablero.

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
- `pnpm typecheck` y `pnpm lint` (solo un aviso ajeno en `video/`), `pnpm build` correctos. `pnpm test`: **1361/1361** (una prueba ajena, `revision-claude`, falló una vez en la suite completa por tiempos y pasa sola) (nuevas: `src/lib/reservas/reservas.test.ts`, 15).
- **RLS** `tests/rls/reservas.rls.test.ts`: **27/27** (tras la revisión) (rol, plan y mora; nadie escribe por la API ni `service_role`; hora local de Madrid frente a Buenos Aires; reintento con `client_key` y envíos simultáneos; mesa doble y asignación simultánea; transiciones; purga; claves compuestas entre organizaciones). Con `acl` y `billing` (listas exactas de funciones y de features actualizadas) y `vistas-previas`, `portada-planes`, `planes-pagos`, `limits`, `rol-cocinero`, `personal-por-sucursal`: **todo en verde**. No se corrió la suite RLS completa de una vez: se colgó dos veces compitiendo con otra corrida y las fallas conocidas de la base local (`catalog`, `carta`, `tenancy`, `push`) vienen de los datos de demostración.
- **E2E** `e2e/reservas.spec.ts` (9/9, con las 4 regresiones de la revisión) a 390 px: cargar, asignar mesa, la ocupada no se ofrece, cancelar y liberar, dato inválido, Resumen con «1 reserva espera», Básico, cocinero y anónimo. Con `acceso`, `sala`, `sala-mesas` (se actualizó la lista de enlaces de la Sala), `personal-por-sucursal`, `panel-llamados-aviso`, `alta-guiada`, `sucursales` y `resumen-panel`: sin fallas propias (`sala.spec.ts:327` falla a veces bajo carga y pasa al repetirlo).
- **Hallazgo de la propia implementación** (corregido con prueba de regresión): cancelar una reserva confirmada violaba `reservations_table_check` porque conservaba la mesa; ahora se suelta la mesa y se conserva su etiqueta.
- Visto en pantalla (Aurelia, escritorio y 390 px): lista por hora, tarjetas con estado en texto, mesas libres, confirmación en dos pasos.
- **No ejecutado:** revisión en un teléfono real; la purga programada con `pg_cron` en producción (documentada en `docs/produccion.md`, 4.d; **en staging quedó programada el 2026-10-31**, ver abajo).
- Recuperación: el rollback de la migración está en su encabezado.

## Revisión y aprobación
**Ronda 1 (Codex, commit `ea2b517`, 2026-10-31): RECHAZAR con 5 hallazgos «importantes». Los 5 se reprodujeron y eran reales.** Cada uno tiene una prueba que falla sin la corrección (las de E2E se corrieron contra el build anterior y fallaron).
1. **Solo lectura:** con la cuenta vencida `org_entitlements` quita la función y la pantalla decía «desde Pro» aunque la política deja leer lo ya cargado. Ahora se ve la lista (sin formularios ni botones) con un aviso. E2E: «con la cuenta en solo lectura…».
2. **Mesas ocupadas después de medianoche:** la lectura cortaba a las 24:00 y no veía la reserva de las 00:30 que se pisa con una de las 23:30. Ahora mira 6 horas antes y después del día. E2E: «una mesa ocupada pasada la medianoche…».
3. **Tope de 1000 filas sin aviso:** la pantalla lo avisa («la lista puede estar incompleta»). E2E con 1005 reservas.
4. **El reintento ignoraba la nota:** la huella de `create_reservation` ahora la incluye. RLS: misma clave con otra nota (o sin nota) → `client_key_reused`.
5. **El Resumen contaba sucursales no asignadas al Staff:** ahora filtra por sus sucursales asignadas. E2E con Staff asignado a una sola.

**Lo que el revisor no pudo comprobar (mutación):** las pruebas de concurrencia que escribí **pasaban aunque se sacara el candado**; no probaban la defensa. Se reemplazaron por pruebas deterministas (otra sesión retiene el candado exacto, la llamada tiene que quedar esperando y lo que cambie mientras tanto cuenta al despertar). Mutación hecha en la base local: sin el candado de la mesa fallan **2** pruebas; sin el candado de la clave, **1**; restaurados, pasan (27/27).

**Ronda 2 (Codex, verificación, commit `00e2301`): RECHAZAR por un solo punto.** Confirmó como corregidos los hallazgos 1, 2, 4 y 5. El 3 quedó **parcial**: con la lectura truncada la pantalla avisaba pero seguía ofreciendo mesas calculadas con datos incompletos. Real; corregido: con la lectura incompleta no se ofrece ninguna mesa («Este día tiene demasiadas reservas para saber qué mesas están libres…»). E2E: la reserva visible no tiene opciones ni botón de confirmar (falló contra el código anterior).

**Ronda 3 (Codex, verificación, commit `c7b51f5`): APROBAR, sin hallazgos nuevos** y los 5 anteriores corregidos. El informe fue estático (no ejecutó pruebas ni mutaciones; esas las hice yo, arriba). El veredicto de Codex no reemplaza tu aprobación.

**Aprobación del usuario para subir a staging (migración incluida): dada el 2026-10-31.**

## Staging (2026-10-31, aprobado por el usuario)
- Migración: `supabase db push --dry-run` mostró solo `20261215100000_reservas.sql`; aplicada en `ucomenu-staging` y el segundo `--dry-run` dice «Remote database is up to date».
- App: Fly **v87** `complete`, máquina `78177dda131e38` sana, imagen `registry.fly.io/ucomenu-staging:reservas-95dd861-git` (copia limpia de `95dd861`). `/`, `/login` y `/m/aurelia/centro` 200, local inexistente 404, `/sala/aurelia/reservas` y `/panel/aurelia` sin sesión 307.
- **No probado:** la pantalla con sesión real en staging ni en un teléfono. Para probarla, un local de demostración de staging tiene que estar en Pro (`aurelia` lo es).
- Marcha atrás de la app: `flyctl deploy -c fly.staging.toml --image registry.fly.io/ucomenu-staging:resumen-104004c-git` (v86; ver el SQL de rollback en el encabezado de la migración, que además deja la tabla sin uso: la v86 no la lee).

## Cambios pedidos después de la fase 1 (2026-10-31, por el usuario)
- **Sin duración por reserva:** se saca el selector «Duración» del formulario y el «hasta las…» de la tarjeta. Una reserva ocupa su mesa un **bloque fijo de 90 minutos** (`RESERVATION_MINUTES`), que la pantalla dice una sola vez en la introducción y que la base recibe como la duración de la reserva: así una mesa no se reserva dos veces seguidas casi a la misma hora. **Sin migración:** `create_reservation` conserva su parámetro de duración (la pantalla siempre manda 90). Si más adelante querés que el bloque sea configurable por sucursal, o que no haya bloqueo por horario, se cambia acá.
- **Vista «Próximas»:** un botón «Próximas» (junto a «Por día») junto a `?ver=proximas` lista todas las reservas vivas de la sucursal que todavía no terminaron, de la más cercana a la más lejana y **agrupadas por día**, hasta 300 (si hay más lo avisa). Se puede asignar mesa, cancelar, etc. desde ahí y se vuelve a esa vista; la reserva que se carga desde ahí también. Las mesas libres se calculan con lo leído; con la lectura cortada solo se ofrecen donde se pueden calcular (`tablesKnown`). **El pendiente del Resumen («N reservas esperan…») ahora enlaza a «Próximas».**
- Pruebas: unitarias (`groupByDay`, `tablesKnown`, `parseView`, sin `duration` en el formulario) y E2E (`reservas.spec.ts`: varias fechas agrupadas y en orden, la cancelada no figura, asignar desde ahí y volver, otra sucursal y lo ya terminado no aparecen, sin campo de duración ni «hasta las»).
- **Staging (2026-10-31, aprobado por el usuario):** Fly **v88** `complete`, máquina `78177dda131e38` sana, imagen `registry.fly.io/ucomenu-staging:proximas-5d0e3bb-git` (copia limpia de `5d0e3bb`). Sin migraciones (`supabase db push --dry-run`: «Remote database is up to date»). `/`, `/login` y `/m/aurelia/centro` 200, local inexistente 404, `/sala/aurelia/reservas` (con y sin `?ver=proximas`) y `/panel/aurelia` sin sesión 307. **No probado:** las pantallas con sesión real en staging. Marcha atrás: `flyctl deploy -c fly.staging.toml --image registry.fly.io/ucomenu-staging:reservas-95dd861-git` (v87, con duración elegible y sin «Próximas»).
- **Purga programada en staging (2026-10-31, pedido del usuario):** `cron.schedule('purge-expired-reservations', '15 6 * * *', ...)` con `supabase db query --linked` (jobid 3, activa); se comprobó que `pg_cron` estaba activo, que había 0 reservas vencidas y que `purge_expired_reservations(interval '30 days', 500)` devuelve 0. **Falta mirar** `cron.job_run_details` después de la primera ejecución real (06:15 UTC) y programarla en producción cuando exista.
