# Cambio: corregir el identificador de una sucursal

Estado: **Hecho en local**, sin integrar ni desplegar. Nivel **M** por migración, panel y ruta; conserva permisos y RLS existentes.

## Alcance y decisiones
- SuperAdmin corrige el identificador desde la ficha de la organización. Dueño y Staff siguen sin UPDATE sobre slug ni sobre sus históricos. Se reutiliza la comprobación de identidad del SuperAdmin antes de usar service_role; sin RPC ni políticas nuevas.
- `branches.slug_aliases` guarda los identificadores anteriores. Un trigger los mantiene junto al cambio y reserva los históricos frente a altas y renombres de otras sucursales de la misma organización, incluso concurrentes. Otra organización sí puede usar el mismo texto.
- Renombres repetidos apuntan directamente al identificador actual. Volver a un identificador propio anterior está permitido y no genera ciclos.
- La carta pública activa redirige al identificador actual; los enlaces anteriores de una cuenta suspendida conservan «Carta temporalmente no disponible». Inactiva/inexistente sigue en 404. Los QR, mesas y disponibilidad conservan sus ids y tokens.
- La escritura confirma id, organización y slug esperado: si otra persona ya lo cambió, pide recargar. Error de red tiene resultado incierto, nunca afirma que no se guardó.
- No incluye slug de organizaciones, eliminación de históricos, cambio de permisos, ni redirecciones externas.
- Motivos de persistencia y reserva de históricos en [ADR 0017](../../docs/decisiones/0017-historicos-de-slug-por-sucursal.md).

## Aceptación
- [x] SuperAdmin corrige y el formulario refleja la dirección nueva; inválido, ocupado y sin cambios dan mensajes claros conservando lo escrito.
- [x] URL anterior y todas las históricas redirigen a la actual; categoría/platos y sucursal no se mezclan. Reversión propia sin ciclos.
- [x] Creación o corrección no puede apropiarse del histórico de otra sucursal; concurrencia conserva unicidad.
- [x] Dueño, Staff y ajenos no corrigen; no se usan privilegios de servicio antes de verificar al actor.
- [x] Cuenta suspendida/inactiva respeta publicación; QR conserva token y muestra la misma sucursal.
- [x] Cambio con una pantalla antigua no anuncia éxito; móvil/escritorio sin desborde.

## Fallos y recuperación
Slug e históricos se actualizan en una sola escritura/transacción. Error SQL revierte ambos; resultado de red incierto exige recargar antes de repetir. Recuperar un identificador propio previo usa el mismo formulario. Revertir la UI conserva datos, pero retirar soporte de históricos rompería los enlaces anteriores: mantener la migración y la lectura de alias hasta decidir una retirada revisada.

## Evidencia
Diff probado de corrección de slug contra `5331d0d`, rama `feat/correccion-slug-sucursal`; el commit que incorpora esta ficha contiene código, pruebas y documentación.
- `pnpm test`: **443/443**.
- `pnpm test:rls tests/rls/branch-slugs.rls.test.ts tests/rls/acl.rls.test.ts tests/rls/sucursales.rls.test.ts tests/rls/tables.rls.test.ts tests/rls/billing.rls.test.ts`: **120/120**. Incluye colisiones e históricos concurrentes, actor falsificado, privilegios sin ampliar, publicación y QR.
- Build nuevo + `pnpm exec playwright test e2e/branch-slugs.spec.ts e2e/menu.spec.ts e2e/sucursales.spec.ts e2e/superadmin-planes-pagos.spec.ts --workers=2`: **44/44**. Después de precisar el mensaje de resultado incierto: typecheck, lint y build nuevos + `e2e/branch-slugs.spec.ts --workers=2`: **2/2**.
- `pnpm typecheck`, `pnpm lint` y `pnpm build`: correctos. Revisión visual de capturas a 390/1280 px y comprobación de desborde: correctas. Sin fallos de pruebas.
- La lectura final del diff detectó un no-op obsoleto: ahora también confirma el slug esperado antes de decir «sin cambios». Regresión agregada; archivo RLS de históricos **7/7**, lint/build y archivo E2E nuevo **2/2** correctos después del ajuste.
- Migración aplicada solo con `supabase migration up --local`, tipos regenerados con `pnpm db:types`. No se ejecutó `db:reset` para conservar la demo manual existente. Seed documenta históricos vacíos; escenarios propios de las pruebas.
- No se repitieron RLS/E2E completos: se verificaron las rutas y contratos afectados. No se invocaron otros agentes; no se requiere revisión independiente por defecto en M.

Reversión: conservar columna y trigger evita perder enlaces aunque se retire la UI administrativa; revertir todo el incremento retiraría también las redirecciones. La recuperación ordinaria es volver al identificador propio anterior desde el mismo formulario. Tamaño autoral mayor a 400 líneas: unidad funcional local; si se abre PR, dividir persistencia/resolución y panel administrativo en una cadena revisable sin recortar pruebas. Sin instalaciones ni operaciones remotas.
