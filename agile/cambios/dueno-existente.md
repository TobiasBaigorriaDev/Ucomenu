# Cambio: SuperAdmin suma una cuenta existente como Dueño de otra organización

Estado: **Implementado; en revisión** (rama `feat/dueno-existente`, desde `main`). Nivel **C**: toca autorización (da el rol de Dueño) y el aislamiento entre locales. Antecedente: [alta de organizaciones](superadmin-alta-de-organizaciones.md), que rechaza un email que ya tiene cuenta.

## Objetivo
Un mismo dueño con dos locales: SuperAdmin escribe el email de una cuenta que **ya existe** y la suma como Dueño de una organización, sin crearla ni tocar su contraseña. Cubre también ascender a Dueño a una cuenta que ya es Personal de esa misma organización.

## Decisiones (aprobadas por el usuario el 2026-10-17)
1. **Alcance:** cualquier cuenta existente, **con aviso y confirmación explícita**. SuperAdmin escribe el email, la pantalla le muestra en qué locales ya trabaja la cuenta y con qué rol, y debe marcar que es la misma persona antes de sumarla. Se descartaron «solo Dueños» (no cierra el riesgo: un Dueño puede ascender a una cuenta de Personal que él creó) y «contraseña nueva obligatoria» (cambia la contraseña de una cuenta en uso).
2. **Solo SuperAdmin.** El Dueño no suma Dueños de otras cuentas: su alta de personal sigue creando cuentas nuevas (`email_unavailable` si el email ya existe, sin revelar quién lo usa).
3. **Una sola puerta de escritura:** función `admin_add_owner` (`SECURITY DEFINER`, solo `service_role`, vuelve a comprobar que el actor es SuperAdmin), con membresía y auditoría en una transacción.
4. **Auditoría:** acción nueva `owner.added`, con las membresías previas de la cuenta (solo identificadores de locales y roles, sin emails).
5. **No se toca la cuenta de Auth** (contraseña, email, confirmación). Sin esquema nuevo salvo la acción de auditoría.

## Riesgo residual (aceptado, documentado)
Si la cuenta era **solo Personal** de otro local A, el Dueño de A pudo haber puesto o restablecido su contraseña, y entonces conocería una cuenta que pasa a ser Dueño de B. Mitigaciones: la pantalla lo avisa antes de confirmar; desde que la cuenta tiene dos locales, la guarda `shared_account` impide que el Dueño de A restablezca su contraseña; queda en la auditoría. Si hay duda sobre quién controla la cuenta, la salida correcta es crear una cuenta nueva con otro email.

## Flujo de uso
El alta de una organización sigue exigiendo un Dueño inicial con **cuenta nueva** (email nuevo y contraseña temporal). Para un dueño con dos locales: crear la organización con un email provisorio, sumar la cuenta existente desde su ficha («Sumar un Dueño») y, si se quiere, que ese Dueño quite la cuenta provisoria desde «Personal» (al no tener otro local, se borra). Hacer que el alta acepte directamente una cuenta existente queda fuera de este incremento.

## Aceptación
- [x] SuperAdmin busca un email: si no hay cuenta, lo dice sin crear nada; si hay, muestra sus locales y roles y pide confirmar.
- [x] Confirmado, la cuenta queda como Dueño de la organización (la ve en el panel y en la lista de SuperAdmin); si era Personal de ella, pasa a Dueño; si ya era Dueño, no cambia nada y lo dice.
- [x] Sin confirmar no se escribe nada. Staff, Dueños, ajenos y anónimos no pueden ejecutarla (ni por la API directa).
- [x] Queda un movimiento `owner.added` en la auditoría de la organización.
- [x] La cuenta conserva su contraseña y sus otros locales.
- [x] 390 px sin desborde.

## (C) Invariantes
- Solo un SuperAdmin crea esta membresía, y solo con `service_role`; la función se niega a otro actor aunque lo pida `service_role`.
- La cuenta de Auth no se crea, no se borra y no se modifica; las membresías existentes de la cuenta no cambian (salvo el ascenso de Personal a Dueño en la misma organización).
- Toda escritura tiene su fila de auditoría en la misma transacción; si algo falla no queda nada.
- No se revela a quienes no son SuperAdmin si un email tiene cuenta.

## (C) Fallos y recuperación
- Doble envío: la segunda vez responde «ya es Dueño» sin escribir (`unique (user_id, organization_id)`).
- Respuesta perdida: reintentar es seguro (idempotente); la pantalla de la organización muestra los Dueños actuales.
- Sumada por error: el Dueño de la organización puede quitarla desde «Personal» (la guarda del último Dueño protege el caso límite) o SuperAdmin por SQL; la auditoría conserva el rastro.

## Evidencia
Pendiente.
