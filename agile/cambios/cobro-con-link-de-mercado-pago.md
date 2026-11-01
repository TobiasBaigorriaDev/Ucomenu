# Cambio: Cobro de la suscripción con link de Mercado Pago (registro automático del pago)
Estado: **implementado en local (2026-11-01), sin commit de integración**; falta la revisión independiente, la aprobación del usuario y la prueba contra Mercado Pago de verdad con credenciales de **prueba** en staging (todavía no se creó la aplicación de Mercado Pago ni se configuró ningún secreto)
Nivel: **C** (dinero y vigencias; ruta pública que mueve fechas de cuenta) · [ADR 0052](../../docs/decisiones/0052-cobro-por-link-de-mercado-pago.md)

## Objetivo
Que el Dueño pague su período desde Suscripción con Mercado Pago (dinero en cuenta, tarjeta u otro medio que acepte Checkout Pro) y que el pago se registre y extienda la vigencia **sin que el SuperAdmin cargue nada**.

## Decisiones
- **Flujo:** «Pagar» (solo Dueño, server action) → intención de pago → preferencia de Checkout Pro (`external_reference` = id de la intención, `notification_url` con `source_news=webhooks`, `back_urls`, vencimiento 72 h) → redirección. Vuelve a Suscripción con `?pago=` y el estado.
- **Importe (la base, `private.payment_quote`):** precio de lista del plan según el ciclo + sucursales adicionales vigentes × su precio del mismo ciclo. En ARS. Congelado en la intención; el navegador solo manda el local.
- **Sucursal adicional anual (aprobada por el usuario el 2026-11-01):** ARS 12.000 por mes → **ARS 115.200 por año** (12 meses con 20 % menos, como los planes), en `addons.yearly_price_cents` (parametrizable, no está en el código). Suscripción muestra el precio anual en cuentas anuales (antes decía «por mes» para todas).
- **Vigencia (en la base):** `covers_until = cierre del día de Argentina de (greatest(fin vigente, ahora) + 1 mes o 1 año)`. Pagar en prueba o antes de vencer no pierde días; pagar vencido cuenta desde el pago. No se ofrece pagar (ni se registra) si ya hay más de un ciclo por delante.
- **Suspensión manual:** el pago extiende la fecha pero **no levanta** `suspended_at`; con suspensión manual no se muestra «Pagar».
- **Premium:** sin precio de lista no hay «Pagar».
- **Una sola puerta de escritura:** las funciones `system_*` y `admin_resolve_payment_review` solo las ejecuta `service_role`; la lectura del Dueño es `owner_payment_quote`. `payment_intents` y `payment_reviews` no se leen ni escriben por la API (el SuperAdmin lee las revisiones).
- **Idempotencia:** `payments.provider_payment_id` único por proveedor (índice parcial) más lock de la suscripción. Un pago ya enviado a revisión no se reevalúa solo. Lo que no cuadra: `amount_mismatch`, `currency_mismatch`, `plan_changed`, `intent_already_paid`, `already_covered`; y `payment_reversed` para un reembolso o contracargo de un pago ya registrado.
- **«Ya pagué, verificar»:** busca los pagos de la intención pendiente en Mercado Pago y aplica los aprobados con la misma función; el resultado viaja en `?pago=` (el bloque pendiente desaparece al registrarse el pago y se llevaría un mensaje inline).
- **El aviso:** firma `x-signature` (HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`), ventana de un día (repetir un aviso es inofensivo: se vuelve a pedir el pago a la API y registrar es idempotente); el cuerpo nunca decide, solo el `data.id` firmado de la URL.
- **Sin dependencia nueva:** `fetch` y `node:crypto`. `MERCADOPAGO_API_URL` solo se respeta si apunta a la propia máquina.
- **Secretos nuevos:** `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` y `NEXT_PUBLIC_SITE_URL` del entorno; **ninguno está configurado en ningún entorno** (`.env.example` y `docs/operacion.md` explican cómo). Requieren aprobación del usuario en cada entorno.
- **Cuenta de Mercado Pago:** hoy una cuenta personal del usuario; antes de producción hay que decidir si cobra ahí o en una del negocio (cambiarla es cambiar los dos secretos).

## Aceptación
- [x] Dado un Dueño con plan y precio de lista, cuando pulsa «Pagar», entonces es llevado a Mercado Pago con el importe que dice la base y no puede alterarlo. *(E2E `cobro-mercado-pago`, RLS `cobro-mercado-pago`)*
- [x] Dado un pago aprobado y un webhook con firma válida, cuando llega, entonces `payments` tiene una fila (`payment_link`, `MP <id>`), la vigencia avanza un ciclo y `audit_log` lo registra, todo en una transacción. *(RLS, E2E)*
- [x] Dado el mismo webhook dos veces o en paralelo, entonces hay un solo pago y una sola extensión. *(RLS con llamadas simultáneas, E2E)*
- [x] Dado un webhook con firma inválida, sin firma o con `ts` fuera de tolerancia, entonces 401 y ningún cambio. *(unitarias, E2E)*
- [x] Dado un pago aprobado con importe distinto, plan o ciclo cambiado, intención ya pagada o ya cubierta, entonces **no** extiende y aparece en «Pagos de Mercado Pago a revisar», que el SuperAdmin resuelve. *(RLS, E2E)*
- [x] Dado un webhook perdido, cuando el Dueño pulsa «Ya pagué, verificar», entonces el pago se registra igual (idempotente). *(E2E)*
- [x] Dado un Staff o un Dueño de otra organización, entonces no puede pedir ni ver intenciones ajenas. *(RLS, E2E)*
- [x] El estado derivado y el cobro manual siguen funcionando igual (suites `billing`, `planes-pagos`, `anular-pagos`, E2E de SuperAdmin).
- [ ] **Contra Mercado Pago de verdad (credenciales de prueba, staging):** crear el link, pagar con un usuario de prueba y recibir el aviso firmado. **No hecho.**

## Fuera de alcance
Cobro recurrente (Mercado Pago Suscripciones), tarjeta guardada, facturas, cambio de plan desde el panel, prorrateo, cron de reconciliación, cuotas, tipo de cambio y ajuste por inflación. Reembolsos **parciales** y contracargos informados solo por el aviso `chargebacks` (solo se detecta el estado `refunded` / `charged_back` del pago; sin quitar la vigencia solo).

## Limitaciones conocidas y puntos a verificar con Mercado Pago real
- Solo se leyó la documentación (Context7, 2026-11-01); **no se probó** nada contra la API real: el formato de `expiration_date_to`, el efecto de `source_news=webhooks`, que `GET /v1/payments/search?external_reference=` funcione con credenciales de prueba, los reintentos del aviso, los medios de pago de Checkout Pro en ARS y las comisiones.
- Un contracargo no quita la vigencia: hay una ventana hasta que el SuperAdmin lo vea (ADR 0052).
- `tools/verificar-produccion` no comprueba las variables nuevas (la función se apaga sola sin ellas).

## Evidencia (2026-11-01, árbol sin commit)
- Migración `20261217100000` aplicada solo en la base **local** (`supabase migration up --local`, sin `db reset`) y `pnpm db:types` regenerado. Primer intento fallido y revertido por una lista de acciones de auditoría desactualizada en la propia migración; corregida con la lista vigente de la base.
- `pnpm test` completo: **1424/1424** (98 archivos; nuevas: `cobro/firma`, `cobro/mercadopago`, `cobro/cobrar`, `cobro/cotizacion`, precio anual de las adicionales). `pnpm lint` sin avisos, `pnpm typecheck` y `pnpm build` correctos.
- RLS `cobro-mercado-pago` (**26/26**: permisos, importe y ciclos, intención, registro idempotente y en paralelo, pagos a revisar, reversiones, resolución del SuperAdmin, unicidad del pago y **mutación** que muestra que sin el índice único el mismo pago entraría dos veces) y `acl` (24/24, inventarios actualizados con las funciones y tablas nuevas). Con ellas, `billing`, `planes-pagos`, `anular-pagos`, `addons-y-baja`, `portada-planes`, `precios-en-pesos-migracion`, `borrado-de-organizaciones` y `limits` pasan.
- E2E (**85/85**): `cobro-mercado-pago` (con un Mercado Pago de mentira, `e2e/mp-stub.ts`, puerto 4012), `suscripcion-precio`, `cuenta-pagos-historial`, los de SuperAdmin (`superadmin`, `-planes-pagos`, `-sucursal-adicional`, `-addons-baja`) y `mesas` (el servidor de pruebas ahora define `NEXT_PUBLIC_SITE_URL`).
- **Falla previa, no de este cambio:** `owner-lectura` › «una acción de auditoría que no está en la lista blanca» falla porque la base local conserva una fila `account.deleted` que la lista restringida de esa prueba no admite (reproducido con el mismo SQL dentro de una transacción deshecha).
- **No ejecutado:** la suite RLS completa, el E2E completo, nada contra staging, producción ni Mercado Pago real. El primer E2E del aviso de verificación reveló que el mensaje se perdía al desmontarse el bloque pendiente; se corrigió pasando el resultado por la dirección.

## (C) Invariantes
1. Solo `service_role` ejecuta las funciones de registro; ninguna vía de la API (anon, Dueño, Staff, SuperAdmin con sesión) escribe `payments`, `payment_intents`, `payment_reviews` ni fechas. *(prueba de permisos en `cobro-mercado-pago` y `acl`)*
2. **Un pago de Mercado Pago extiende la vigencia una sola vez** (único por ID de pago, también en paralelo) y como máximo un ciclo por pago.
3. El importe, la moneda y el período salen de la base, no de la petición ni del cuerpo del aviso; lo que cuenta es la respuesta de la API de Mercado Pago.
4. Lo que no cuadra no extiende: falla cerrado y queda a la vista del SuperAdmin.
5. `payments` sigue siendo de solo agregado; corregir es anular y registrar.
6. Ningún secreto ni dato personal del pagador entra en Git, base, auditoría ni registros (la preferencia no lleva datos del comprador; el registro del servidor no incluye el token).

## (C) Fallos y recuperación
- **Webhook perdido o tardío:** el botón «Ya pagué, verificar» lo cubre; el SuperAdmin puede registrar a mano.
- **Webhook duplicado o en paralelo:** el lock de la suscripción y la unicidad por ID de pago lo hacen inocuo.
- **Error transitorio al consultar a Mercado Pago o a la base:** la ruta responde 500 y Mercado Pago reintenta (a verificar); nunca se trata como éxito. Un dato que la base rechaza por su forma (`22023`) se informa `invalid` y no se reintenta.
- **Pago registrado por error:** `admin_void_payment` (ADR 0024) lo anula y la vigencia vuelve.
- **Contracargo o reembolso:** queda «a revisar»; el SuperAdmin anula el pago. Hay una ventana hasta que lo note.
- **Marcha atrás:** el rollback está en el encabezado de la migración (en una transacción; los pagos ya registrados no se tocan). Apagar la función es quitar los secretos: la pantalla vuelve al cobro manual sin desplegar nada. El cobro manual nunca dejó de funcionar.

## (C) Revisión y aprobación
- Diseño aprobado por el usuario el 2026-11-01 (cifra anual incluida).
- **Pendiente:** revisión independiente de la implementación (una ronda, solo lectura) y aprobación del usuario para staging y para producción.
