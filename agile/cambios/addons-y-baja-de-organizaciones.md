# Cambio: SuperAdmin gestiona los add-ons y da de baja / reactiva organizaciones
Estado: para verificar — implementado, verificado en local y aprobado por Codex (rama `feat/addons-y-baja-organizaciones`); falta la aprobación humana, integrar a `main` y aplicar la migración en staging. Alcance elegido por el usuario el 2026-10-19: add-ons con packs y fin, baja completa (nadie entra) y **sin borrado**.
Nivel: C (autorización: nueva escritura solo de SuperAdmin y corte de acceso por RLS; exposición: el acceso del local a su información; dinero: el cupo y la feature que paga el add-on)

## Objetivo
Cerrar dos incrementos de SuperAdmin que quedaban: (1) activar, cambiar y finalizar add-ons de una organización, y (2) dar de baja y reactivar una organización sin borrar nada, de modo que la baja cierre de verdad el acceso del local. El **borrado** de organizaciones queda fuera: sigue bloqueado hasta definir la retención (ADR 0012).

## Decisiones
Los motivos duraderos están en el [ADR 0025](../../docs/decisiones/0025-baja-de-organizaciones-y-addons.md). Particulares de esta ficha:
1. **Alcance (usuario, 2026-10-19):** add-ons + baja/reactivación, sin borrado; baja = «nadie entra»; add-ons = activar, cambiar packs y fecha de fin, finalizar, con motivo y auditoría.
2. **Tres funciones de base** (solo `service_role`, recomprueban al actor, lock, auditoría en la misma transacción): `admin_set_addon`, `admin_end_addon`, `admin_set_organization_active`. Migración `20261030100000_addons_y_baja_de_organizaciones.sql`.
3. **La baja se aplica en `private.is_org_member` / `private.is_org_owner`** (y `org_state` devuelve `suspended`): nadie del local lee ni escribe por la API. Lo que hay en `organizations.is_active` para el público no cambia (la carta y los QR dan 404, como una organización inexistente).
4. **Add-on:** solo sobre un plan que lo admite; packs 0–50; fin opcional (futuro, ≤ 731 días); «sin cambios» se rechaza sin auditoría; finalizar conserva los packs.
5. **El Dueño ve** `addon.*` (cuál, packs, fin) y `organization.reactivated` (sin detalle) en su historial; nunca motivo ni autor. La baja no la puede ver.
6. **Pantalla** `/admin/organizaciones/{slug}`: secciones «Add-ons» y «Dar de baja / Reactivar la organización» (la baja pide una casilla de confirmación; reactivar no).

## Aceptación
- [x] Un SuperAdmin activa WebAR sobre Pro o Premium: queda un contrato, el Dueño ve la feature `webar` y el cupo (15 + 10 por pack) y hay **una** auditoría `addon.activated` con motivo.
- [x] Cambiar packs o fecha de fin es `addon.changed` (con el antes); repetir lo mismo se rechaza (`addon_unchanged`) sin auditoría; quitar la fecha de fin (campo vacío) también es un cambio.
- [x] Sobre Básico no se activa ni se cambia (`addon_not_allowed`); si el plan baja a Básico, la fila queda pero deja de dar feature y cupo; finalizar sigue siendo posible.
- [x] Finalizar un add-on vigente lo deja sin feature ni cupo, conserva los packs y audita `addon.ended`; no se finaliza dos veces ni uno no contratado; volver a activarlo es `addon.activated`.
- [x] Packs fuera de 0–50, fechas pasadas/inexistentes/lejanas, motivo vacío o de más de 200 y add-on desconocido se rechazan **sin dejar contrato ni auditoría**, tanto en el módulo como directo en la base.
- [x] Dar de baja deja `is_active = false`, **no toca** la suscripción ni los pagos y deja **una** auditoría `organization.deactivated` con motivo; reactivar deja `organization.reactivated`.
- [x] Dada de baja, el Dueño y el Staff no leen ni escriben nada de su local por la API (organización, sucursales, carta, suscripción, pagos, historial, `org_entitlements` = null) y no registran avisos push; quien tiene otro local sigue entrando a ese.
- [x] Su carta pública responde igual que una inexistente y vuelve a abrir al reactivar; el personal vuelve a entrar y los datos siguen; si la cuenta venció mientras tanto, queda en la mora que dicen sus fechas.
- [x] Ya está de baja / ya activa, organización inexistente y motivo inválido se rechazan sin huella; dos bajas (o dos activaciones, o dos finalizaciones) simultáneas dejan una sola.
- [x] Dueño, Staff, cuenta común, anon y un SuperAdmin **con sesión** no llaman las tres funciones por la API (`42501`); un actor que no es SuperAdmin con `service_role`, tampoco (`not_platform_admin`).
- [x] El Dueño ve en su historial los add-ons (cuál, packs, fin) y la reactivación, sin motivo, autor, slug ni ids; el Staff y otro Dueño no ven nada.
- [x] `/admin/organizaciones/{slug}`: add-ons con estado, cupo y formularios (activar/cambiar/finalizar), aviso cuando el plan no lo admite, baja con casilla de confirmación y reactivación; sin desborde a 390 px.

## Fuera de alcance
- **Borrado y purga de organizaciones** (y la retención de `price_history`, `payments` y `payment_voids`): ítem aparte, sigue bloqueado por ADR 0012. Dar de baja no libera el `slug`.
- Que el público vea «no disponible» en vez de 404 en una organización dada de baja (mejora aparte, ADR 0025).
- Catálogo de modelos 3D y «Ver en mi mesa» (fase 2): el cupo y la feature quedan listos pero no habilitan nada hasta entonces.
- Mostrarle al Dueño su add-on en su pantalla de suscripción (hoy solo en el historial).
- Otros add-ons (el catálogo solo tiene `webar`) y precios por tramos.

## Evidencia
Base local (`pnpm db:reset` con todas las migraciones y el seed), 2026-10-19; el commit probado se anota en «Revisión y aprobación»:
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK · tipos regenerados (`pnpm db:types`).
- `pnpm test` **666/666** (nuevas: validación de packs y fin, traducción de errores, resultado incierto y texto del historial del Dueño, en `planes-pagos.test.ts` y `lectura.test.ts`).
- `pnpm test:rls`: 37 pruebas nuevas en `tests/rls/addons-y-baja.rls.test.ts` (las dos del reloj viejo salen de la revisión de Codex) (quién puede, activar/cambiar/finalizar, plan que lo admite, validaciones en el módulo y en la base, concurrencia en 4 rondas, historial del Dueño, baja y reactivación, corte de acceso, push, carta pública, dos locales). Corrida completa (antes de la ronda de revisión): 784/785 con una sola falla, **obsoleta a propósito**: `availability.rls` esperaba que el Dueño leyera la disponibilidad de una organización inactiva; ahora no la lee (ADR 0025) y la prueba pasó a comprobar eso y que el dato sigue ahí. Repetidos `availability`, `addons-y-baja` y `acl` (que suma las tres funciones a la lista de funciones de la API): 61/61.
- E2E (`pnpm exec playwright test --workers=1`): 6 pruebas nuevas en `e2e/superadmin-addons-baja.spec.ts` (flujo completo con el Dueño, plan Básico, errores, la baja con casilla, 404 de carta/panel/sala, reactivación, 390 px). La corrida completa se cayó a mitad (`ERR_CONNECTION_REFUSED` desde `idiomas.spec.ts`: el servidor de pruebas dejó de responder; las 112 anteriores pasaron). Se repitieron los 17 archivos restantes: 314 pasaron, 1 omitida y **1 falló por mi cambio**: `superadmin-planes-pagos` «64 caracteres» desbordaba a 390 px porque la casilla de la baja repite el nombre (80 caracteres sin espacios). Corregido (`min-w-0 [overflow-wrap:anywhere]`); build y las dos specs de SuperAdmin repetidas: 20/20.
- **Mutaciones** (defensas rotas de a una en la base local con `create or replace`, restauradas después): 21 probadas, **21 detectadas** (la 8, motivo sin validar en la base, no se detectaba al principio: se agregó la prueba directa y ahora sí). `is_org_member`, `is_org_owner` y `org_state` sin `is_active`; `admin_set_addon` sin plan, sin «sin cambios», sin lock, sin comprobar al actor, sin validar packs ni motivo, con acción de auditoría fija; `admin_end_addon` sin comprobar que esté vigente y sin poner la fecha; la baja sin «ya está de baja», sin lock y con acción fija; las dos funciones con `now()` en vez del instante real tras el lock (reloj viejo); el historial del Dueño que filtra el motivo o muestra la baja; `EXECUTE` a `authenticated`/`anon`.
- **No probado / límites:** staging y producción (la migración no se aplicó fuera de local); lector de pantalla y teléfono real (solo 390 px emulado); atomicidad por inyección de fallos (cada rechazo prueba que no deja filas; cada función es una sola transacción); el formulario no verifica en el servidor la casilla de confirmación de la baja (es una guarda de la pantalla; la autoridad es la base); Storage (subir logos o fotos de una organización dada de baja) no se probó aparte: depende de las mismas funciones de pertenencia.

## (C) Invariantes
1. Solo `service_role`, con un actor que sigue siendo SuperAdmin, escribe `subscription_addons` y `organizations.is_active`; la API no puede (privilegios y ACL probados); cada cambio deja su auditoría en la misma transacción.
2. Una organización con `is_active = false` no tiene miembros ni Dueños para la base: ninguna política, función de lectura del Dueño ni escritura del local la deja pasar; `org_state` es `suspended`.
3. La baja no borra ni modifica nada más: ni suscripción, ni pagos, ni sucursales, ni historial; reactivar lo devuelve todo.
4. Un add-on solo concede feature y cupo si el contrato está vigente **y** el plan actual lo admite; un solo contrato por organización y add-on (`unique`).
5. El motivo, el autor y los ids no llegan al Dueño.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| Error con SQLSTATE | Rollback: sin cambio ni auditoría. Mensaje claro por causa. |
| Se pierde la respuesta (sin SQLSTATE) | `uncertain_change`: recargar y mirar el estado y los movimientos. Repetir es seguro: da «sin cambios» / «ya está» / «ya no está vigente». |
| Dos SuperAdmin a la vez | El lock serializa: el segundo recibe «sin cambios», «ya está de baja» o «no está vigente». |
| Baja por error | «Reactivar» devuelve todo como estaba (mismas direcciones y QR). |
| Add-on cargado mal | Se cambia (`addon.changed`) o se finaliza; queda toda la historia en la auditoría. |
| Falta `SUPABASE_SERVICE_ROLE_KEY` | «El SuperAdmin no está configurado en este servidor»; no se cambia nada. |

## (C) Seguridad y permisos
- Amenaza: un Dueño o Staff activa add-ons, se reactiva o se da de baja (o lo intenta por la API) → `EXECUTE` solo para `service_role` (ACL probada), `requirePlatformAdmin` en página y acción, recomprobación en la función.
- Amenaza: una cuenta dada de baja sigue operando → el corte está en las funciones de pertenencia de la base, no en la pantalla; probado por la API (lecturas, escrituras, avisos push) y con la prueba existente de `availability` ajustada (el Dueño ya no la lee).
- Amenaza: fuga del motivo/autor al Dueño → proyección por lista blanca (ADR 0021); probado con motivos secretos.
- Límite aceptado (igual que ADR 0013): quien tenga la clave `service_role` puede invocar las funciones con cualquier `p_actor` SuperAdmin.

## Migración y rollback
`supabase/migrations/20261030100000_addons_y_baja_de_organizaciones.sql`: tres funciones nuevas, `check` de `audit_log.action` ampliado y cuatro funciones reemplazadas con `create or replace` (`is_org_member`, `is_org_owner`, `org_state`, `owner_account_history`; conservan permisos). Aditiva, sin datos. Rollback en su cabecera (`git revert` + `pnpm db:reset` en local). **Nada se aplicó contra staging ni producción**: aplicarla en staging necesita la aprobación del usuario.

## (C) Revisión y aprobación
- **Ronda 1 (Codex, commit `bc2067c`):** APROBAR CON CAMBIOS, un hallazgo Importante, **real y reproducido por razonamiento y luego por prueba**: `admin_end_addon` (y `admin_set_addon` al decidir si el contrato estaba vigente) comparaba con `now()`, que es el inicio de la transacción. Un pedido que esperó el lock mientras otro finalizaba veía el `ends_at` de ese otro como futuro: finalizaba de nuevo, duplicaba `addon.ended` y retrocedía la fecha. **Corregido** (`9bf56df`): `clock_timestamp()` tomado con los locks adquiridos y usado para validar, escribir y auditar. Prueba de regresión determinista (una transacción de psql que fija `now()`, duerme y llama; mientras tanto otra finaliza) que **falla sin la corrección** (comprobado con las dos funciones mutadas). La prueba de concurrencia que ya existía pasaba por suerte de orden.
- **Ronda 2 (verificación, `9bf56df`):** APROBAR CON CAMBIOS, un hallazgo Importante, **válido**: las regresiones esperaban 600 ms a que psql arrancara y podían pasar sin la defensa. **Corregido** (`d0eda43`): esperan a ver la sesión dentro de `pg_sleep` en `pg_stat_activity` (si no aparece, la prueba falla) y se volvió a comprobar que fallan con `now()`. Además se toleró el desfase del reloj del Docker local (~60 ms adelantado) en dos aserciones.
- **Ronda 3 (verificación, `d0eda43`):** **APROBAR**, sin hallazgos nuevos; los dos previos, corregidos. Revisión estática (Codex no ejecutó suites).
- Tras las correcciones: `addons-y-baja` 37/37, `acl`, `owner-lectura`, `planes-pagos` y `availability` en verde, `pnpm lint` y `typecheck` limpios.
- **Aprobación humana:** pendiente (permisos y corte de acceso: nivel C). Nada se aplicó en staging ni en producción.
