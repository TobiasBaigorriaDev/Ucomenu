# 0021 — El Dueño lee los pagos y el historial de su cuenta por funciones con proyección segura

- Estado: aceptada (decisión técnica; los datos que se muestran quedan en la ficha `dueno-lee-pagos-y-auditoria` para que el usuario los confirme)
- Fecha: 2026-10-18

## Contexto
`payments` y `audit_log` (ADR 0012 y 0013) solo los leen los SuperAdmin. El Dueño de un local no podía ver qué pagos tiene registrados ni qué cambios hizo el equipo de UcoMenu en su cuenta: tenía que preguntar. Pero esas tablas guardan datos que el cliente no debe ver: quién del equipo actuó (`actor_email`, `registered_by`), el motivo escrito a mano en cada cambio (puede ser una nota interna), el id del usuario que se sumó como Dueño y los locales donde trabaja esa persona.

## Decisión
1. **Las tablas no se abren.** No hay política de lectura para el Dueño: siguen siendo de solo-agregado y de lectura exclusiva de SuperAdmin.
2. **Dos funciones `SECURITY DEFINER` solo de lectura**, `owner_payments` y `owner_account_history`, entregan una **proyección elegida**: columnas fijas para los pagos; para el historial, una **lista blanca de acciones** y, por acción, una lista de claves tomadas de `before`/`after` (nunca el JSON crudo). Sin autor (la pantalla dice «Equipo de UcoMenu»), sin motivo, sin ids ni locales de terceros.
3. **Solo un Dueño actual** de la organización recibe filas (`private.is_org_owner`); cualquier otra identidad —Staff, Dueño de otro local, sin rol, anon, un SuperAdmin sin membresía— recibe cero filas, igual que con un local inexistente. Se ve con la cuenta vencida o suspendida: es justo cuando más lo necesita.
4. **Una acción nueva de auditoría queda oculta** hasta que se la sume a propósito a la función. El detalle de una acción nueva con datos sensibles no se filtra por omisión.
5. Paginación por fecha (`p_before`), con tope de 100 filas por pedido; la pantalla (`/panel/{slug}/suscripcion`) pide una de más para saber si hay otra página.

## Consecuencias
- Cada acción de SuperAdmin que se agregue en adelante necesita decidir **qué parte** ve el Dueño (por defecto: nada).
- Corregir un pago mal cargado y el borrado de organizaciones siguen siendo ítems aparte (retención de pagos y `price_history` pendiente).
- Es el mismo patrón que la pantalla del historial de precios (el Dueño ve una proyección, no la tabla).
