# Cambio: Propina sugerida por sucursal
Estado: en curso
Nivel: C

## Objetivo
El Dueño elige una propina sugerida por sucursal y el cliente ve su porcentaje, importe y total opcional al consultar la cuenta; el mozo ve el mismo desglose en la precuenta e impresión.

## Decisiones
- Propuesta aprobada por el usuario el 2026-10-26. Configuración en Sucursales, solo Dueño con cuenta habilitada para escribir.
- Desactivada por defecto (`tip_percent = null`); activada: porcentaje entero de 1 a 100, validado en servidor y base. El formulario propone 10 al activar por primera vez.
- Se aplica el porcentaje vigente al consultar, sobre el consumo de líneas no canceladas, con opciones y precios copiados al anotar. Redondeo al centavo más cercano, mitad hacia arriba.
- Se muestran consumo, «Propina sugerida (N %)», «Total con propina sugerida» y «La propina es opcional». Cero consumo o pedido anulado no lleva sugerencia.
- Es una sugerencia visual: no registra cobros ni propinas, no altera pedidos, ventas o analítica. La precuenta histórica también usa la configuración vigente, no representa una propina cobrada.

## Aceptación
- [x] Dueño puede activar, modificar y desactivar por sucursal; persiste al recargar.
- [x] Staff, cocinero, ajenos, anónimos y cuentas bloqueadas no pueden modificarla por API.
- [x] Cuenta del cliente mantiene los controles de ticket, turno y pedido de cuenta; muestra el desglose correcto con es/en/pt (traducciones cubiertas en unitarias; flujo de navegador en español).
- [x] Precuenta e impresión coinciden para el mismo consumo y porcentaje; cancelados no suman.
- [x] Desactivada o consumo cero: no se muestra sugerencia y se mantiene el total consumido.
- [x] Configuración inválida o respuesta inesperada no produce importes inventados.

## Fuera de alcance
Cobrar, distribuir o registrar propinas; pagos online; cambios remotos o despliegue.

## Evidencia
- Alcance: diff de `feat/propina-sugerida` contra el punto de partida `41c82c2`; preservar `tools/escenarios-locales.mjs` ajeno. Unidad vertical única: configuración más lectura y presentación, sin PR ni publicación remota.
- `pnpm db:start`, `pnpm db:reset`, `pnpm db:types`: migración `20261209100000` aplicada en local y tipos regenerados. `pnpm exec supabase db lint --local --level error`: sin errores de esquema.
- `pnpm test`: 77 archivos, 1209/1209 casos. Las pruebas enfocadas de cuenta, precuenta, propina e idiomas: 108/108. Se corrigió una coincidencia literal es/pt en el texto nuevo.
- `pnpm test:rls tests/rls/propina-sugerida.rls.test.ts tests/rls/cuenta-del-comensal.rls.test.ts tests/rls/sucursales.rls.test.ts`: 31/31. Primera corrida: una lista blanca de respuesta desactualizada; se agregó el campo nuevo y se repitió. Comprueba API directa, mora, aislamiento, límites, turnos y paridad cuenta/precuenta.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: pasan. Se corrigió la sintaxis de literales BigInt para el target ES2017; el build inicial que había comenzado antes de esa corrección falló por ese motivo, el build actualizado pasó.
- Navegador: `pnpm exec playwright test e2e/sucursales.spec.ts e2e/cuenta-del-comensal.spec.ts e2e/sala-precuenta.spec.ts --workers=1`: 16/30 pasan (incluidos ambos casos nuevos), luego el servidor deja de escuchar en 3100; el primer caso afectado vence esperando un aviso y los otros 13 fallan con `ERR_CONNECTION_REFUSED`. Reintento único del mismo comando con `--last-failed`: 14/14 pasan, sin cambios de código. Total: 30 escenarios verificados, sin una corrida única completa verde.
- Inspección visual de capturas en `output/propina-{cliente-mobile,precuenta-impresion,config-mobile,config-desktop}.png`: importes separados, texto opcional legible, configuración sin desborde; se preservó el diseño existente. El hook de diseño avisó un sidecar de DESIGN.md desactualizado, ajeno al cambio; no se regeneró.
- No se ejecutaron suites completas de RLS/E2E: se cubrieron las rutas afectadas. No se aplicó nada remoto.

## (C) Invariantes
- El total consumido no incluye propina y nunca cambia por esta configuración.
- La lectura pública de pedidos sigue exclusivamente en `get_table_account`, solo service_role y tras verificar la visita en servidor.
- Escritura con cliente de sesión, rol Dueño y RLS vigente; aislamiento por organización y permiso solo sobre la columna nueva.
- Aritmética exacta en centavos, sin resultados fuera del rango entero seguro.

## (C) Fallos y recuperación
- Fallo de guardado o cero filas: informar error, sin confirmar éxito. Fallo de lectura: error existente, sin inventar porcentaje.
- Desactivar por sucursal quita inmediatamente la sugerencia al volver a consultar. Reversión de código puede dejar la columna aditiva sin uso; restaurar cuerpo anterior de `get_table_account` si se revierte su contrato. Local: revertir incremento y reset de base de pruebas.

## (C) Revisión y aprobación
- Usuario aprobó desarrollar el alcance propuesto. Pendiente revisión independiente de Claude tras verificar. No hay aprobación de despliegue ni migración remota.
