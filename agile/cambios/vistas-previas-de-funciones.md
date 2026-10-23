# Cambio: Vistas previas de funciones por organización
Estado: **implementado, verificado en local, aprobado por Codex y por el usuario; migración y app en staging (2026-10-23, Fly versión 36)**.
Nivel: C (autorización: habilita funciones fuera del plan que paga la organización)

## Objetivo
Que el SuperAdmin habilite una función nueva a un local piloto antes de que llegue a todo un plan, por tiempo limitado, con motivo y auditada. Motivos y alternativas en [ADR 0039](../../docs/decisiones/0039-sucursal-adicional-y-vistas-previas.md), decisión 5.

## Decisiones
1. **Tabla** `organization_feature_previews` (organización, función, `ends_at`, motivo, fechas), una fila por par. Funciones habilitables: `orders`, `promotions`, `review_invite` y `customers` (un `CHECK`; cada ficha de función la lee con `has_feature` y agrega su clave al plan que corresponda). Sin `INSERT`/`UPDATE`/`DELETE` para nadie, ni siquiera `service_role`; solo la leen `service_role` (la ficha del SuperAdmin). El Dueño y el Staff no la leen ni ven sus movimientos.
2. **Entitlements:** `private.plan_grants(org, feature)` = features del plan **o** una vista previa con `ends_at > clock_timestamp()`. `has_feature` no cambia: la mora manda (gracia concede; solo lectura y suspendida no, porque esas claves no están entre las que se ven en solo lectura). `org_entitlements` suma las cuatro claves a la lista que informa.
3. **Dos funciones, solo `service_role`:** `admin_set_feature_preview(actor, org, función, fin, motivo)` (alta o cambio de fin) y `admin_end_feature_preview(actor, org, función, motivo)`. Recomprueban al actor, bloquean la suscripción (se serializan con plan, pagos y add-ons) y escriben `audit_log` en la misma transacción: `feature_preview.started | changed | ended`, con motivo.
4. **Reglas:** fin obligatorio, futuro y de hasta **90 días** (la aplicación lo escribe como fecha, vale hasta las 23:59 de Argentina; la base deja un día de margen). Motivo de 1 a 200 caracteres. Si el plan ya incluye la función, `feature_in_plan`; si la vista previa vigente ya vence en ese fin, `preview_unchanged`; terminar una no vigente, `preview_not_active`. Terminada o vencida, la fila se conserva y se puede volver a habilitar.
5. **Ficha del SuperAdmin:** bloque «Vistas previas de funciones» compacto: una fila plegable por función con su estado (sin vista previa / vigente hasta / terminó) y, al abrirla, el formulario de fin y motivo y el de terminar. No se ofrecen las funciones que el plan ya incluye; si el plan las incluye todas, el bloque lo dice. Sin el bloque en el panel del Dueño.
6. **Lo que NO hace todavía:** ninguna de las cuatro funciones existe aún, así que la vista previa solo se observa en `has_feature` y `org_entitlements`. El bloque lo dice. `review_invite` no se cableó a la invitación ya implementada (hoy depende del plan).

## Aceptación
- [x] Sin vista previa, ninguna de las cuatro claves se concede; con una vigente, la organización la tiene (Dueño y Staff la ven en `org_entitlements`) y las demás organizaciones y funciones no.
- [x] Al vencer sola o al terminarla, deja de conceder en el acto.
- [x] En solo lectura y suspendida (también a mano) no concede; en gracia sí.
- [x] Solo un SuperAdmin escribe: Dueño, Staff y anónimo no ejecutan las funciones ni leen/escriben la tabla; un actor que no es SuperAdmin recibe `42501` aunque use la clave de servicio.
- [x] Fin ausente, pasado o de más de 90 días, motivo vacío o largo, función fuera de la lista, organización inexistente: error y ni una fila ni un movimiento.
- [x] Cada alta, cambio y fin deja un movimiento con motivo y actor; el Dueño no lo ve ni en su historial ni el motivo.
- [x] Dos habilitaciones simultáneas quedan en una fila (`started` + `changed`); habilitar contra terminar queda en uno de los dos órdenes, nunca a medias.

## Fuera de alcance
Cobro, que el Dueño vea o pida vistas previas, avisos al Dueño antes del fin, vistas previas de funciones que ya existen en un plan (`video_feed`, `loyalty`), prórroga automática, vistas previas por sucursal.

## Evidencia
Sobre el diff de `main` (2026-10-23), migración `20261121100000`:
- `pnpm db:reset` y `pnpm db:types` con la migración; `pnpm typecheck` y `pnpm lint` limpios; `pnpm build` en verde.
- RLS: `vistas-previas` 20/20 y `acl` 22/22 (tras la ronda 1) (la lista de columnas de `branches` estaba desactualizada desde la ficha del enlace de reseñas: se agregó `google_review_url`). Mutación: sin `ends_at > clock_timestamp()` en `plan_grants`, fallan 4 pruebas (vencer sola, terminar, volver a habilitar y habilitar contra terminar). La prueba de `feature_in_plan` simula el plan en una transacción que se revierte (ninguna clave está todavía en un plan).
- Corrida completa de `pnpm test:rls` (54 archivos): 1193 de 1193 en verde.
- Unitarias: validación, rechazos antes de la base y traducción de errores (`src/lib/admin`, 120 en verde).
- E2E contra el build: `superadmin-vistas-previas` 2/2 (habilitar, cambiar el fin, terminar; el Dueño no ve nada; fin fuera de rango) más `superadmin-sucursal-adicional` y `superadmin-addons-baja` en verde.
- Staging (2026-10-23): `supabase db push --dry-run` mostró solo `20261121100000` y `supabase db push` la aplicó a `ucomenu-staging`; un nuevo `--dry-run` confirma que la base está al día. Commits en `origin/main` (`b87bacb`); Fly `ucomenu-staging` versión 36 (imagen `deployment-01M5N8G3P1FT9WCSFY8N7J2NX5`, marcha atrás: `fly deploy -c fly.staging.toml --image` con la de la v35). `/`, `/login`, `/terminos` y `/privacidad` responden 200 y `/admin` redirige al login.
- Ajuste de interfaz (2026-10-23, solo local; sin desplegar): filas plegables (el bloque a 390 px mide menos de 480 px) y `previewableFeatures` oculta lo que el plan ya incluye (unitaria). `superadmin-vistas-previas` 2/2 y `superadmin-sucursal-adicional` 3/3 contra el build.
- Sin probar: el bloque con sesión real de SuperAdmin en staging.

## (C) Invariantes
- Solo `service_role`, desde una acción de SuperAdmin, escribe vistas previas, y siempre con `audit_log` en la misma transacción.
- Una vista previa vencida o terminada no concede nada; la mora manda sobre ella.
- El Dueño y el Staff nunca leen la tabla ni sus movimientos.

## (C) Fallos y recuperación
- Función habilitada por error: el SuperAdmin la termina (efecto inmediato); queda el movimiento.
- Carrera entre dos acciones del SuperAdmin: el lock de la suscripción las ordena; la segunda ve el estado de la primera.
- Rollback de la migración: ver el encabezado de `20261121100000_vistas_previas_de_funciones.sql` (falla si ya hay movimientos `feature_preview.*`: habría que conservarlos).

## (C) Revisión y aprobación
- Diseño aprobado por el usuario el 2026-10-23 (ADR 0039, decisión 5).
- Revisión independiente de Codex, ronda 1 sobre `196e5a6` (nivel C, solo lectura, estática): APROBAR CON CAMBIOS, un hallazgo. **Real:** la prueba de actor no SuperAdmin cubría solo `admin_end_feature_preview`; quitar la guarda de `admin_set_feature_preview` no se habría detectado. Corregido con una llamada directa de alta con `service_role` y actor Dueño (`42501`, sin fila ni movimiento); sin la guarda, esa prueba falla (comprobado).
- Ronda de verificación sobre `eb5d1d4`: sin hallazgos, hallazgo previo corregido; veredicto **APROBAR**. No reemplaza la aprobación del usuario.
- Aprobación del usuario para subir la migración a staging: 2026-10-23 (solo la migración; el despliegue de la app queda aparte).
