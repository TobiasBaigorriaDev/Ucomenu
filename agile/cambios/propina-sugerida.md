# Cambio: Propina sugerida por sucursal
Estado: desplegado en staging (Fly v64); pendiente comprobación manual del usuario
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
Cobrar, distribuir o registrar propinas; pagos online y producción. Push y staging autorizados posteriormente por el usuario.

## Evidencia
- Alcance probado y revisado: commit `ad2e3cb`, rama `feat/propina-sugerida`, desde `41c82c2`; preservar `tools/escenarios-locales.mjs` ajeno. Unidad vertical única: configuración más lectura y presentación, sin PR ni publicación remota.
- `pnpm db:start`, `pnpm db:reset`, `pnpm db:types`: migración `20261209100000` aplicada en local y tipos regenerados. `pnpm exec supabase db lint --local --level error`: sin errores de esquema.
- `pnpm test`: 77 archivos, 1209/1209 casos. Las pruebas enfocadas de cuenta, precuenta, propina e idiomas: 108/108. Se corrigió una coincidencia literal es/pt en el texto nuevo.
- `pnpm test:rls tests/rls/propina-sugerida.rls.test.ts tests/rls/cuenta-del-comensal.rls.test.ts tests/rls/sucursales.rls.test.ts`: 31/31. Primera corrida: una lista blanca de respuesta desactualizada; se agregó el campo nuevo y se repitió. Comprueba API directa, mora, aislamiento, límites, turnos y paridad cuenta/precuenta.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: pasan. Se corrigió la sintaxis de literales BigInt para el target ES2017; el build inicial que había comenzado antes de esa corrección falló por ese motivo, el build actualizado pasó.
- Navegador: `pnpm exec playwright test e2e/sucursales.spec.ts e2e/cuenta-del-comensal.spec.ts e2e/sala-precuenta.spec.ts --workers=1`: 16/30 pasan (incluidos ambos casos nuevos), luego el servidor deja de escuchar en 3100; el primer caso afectado vence esperando un aviso y los otros 13 fallan con `ERR_CONNECTION_REFUSED`. Reintento único del mismo comando con `--last-failed`: 14/14 pasan, sin cambios de código. Total: 30 escenarios verificados, sin una corrida única completa verde.
- Inspección visual de capturas en `output/propina-{cliente-mobile,precuenta-impresion,config-mobile,config-desktop}.png`: importes separados, texto opcional legible, configuración sin desborde; se preservó el diseño existente. El hook de diseño avisó un sidecar de DESIGN.md desactualizado, ajeno al cambio; no se regeneró.
- No se ejecutaron suites completas de RLS/E2E: se cubrieron las rutas afectadas. La etapa local no modificó entornos remotos.

### Staging y push (2026-10-26)
- Autorización explícita del usuario: «Realiza el push y el stanging». Rama integrada por fast-forward en `main`; `git push origin main` publicó hasta `83c488d`, incluidos los dos commits anteriores de personal por sucursal que ya estaban desplegados.
- Destino comprobado: Supabase staging `oasixhsdyigimwvcxtkx`. `db push --linked --dry-run --skip-vault` listó únicamente `20261209100000_propina_sugerida.sql`; aplicada con `db push --linked --skip-vault --yes`, sin seeds ni roles. Dry-run posterior: `upToDate: true`.
- Consulta de metadatos remota: columna `smallint` nullable, CHECK 1–100, UPDATE para authenticated bajo RLS vigente; anon sin SELECT/UPDATE de la columna; `get_table_account` SECURITY DEFINER, search_path vacío y EXECUTE solo service_role. Token inválido devuelve `not_found`. No se consultaron pedidos ni datos de clientes.
- Imagen final construida desde `git archive 83c488d`, desplegada con `flyctl deploy -c fly.staging.toml --local-only --depot=false`: **Fly v64**, imagen `registry.fly.io/ucomenu-staging:propina-83c488d-git`, digest `sha256:279a587a9ca0e7782b2305ec37ddb2bdb9afb3647165d2488a9c745fcc7072ee`; máquina `started`, 1 control pasando. Build y tipos en Docker correctos; mismo proyecto, URL pública y correo de prueba que staging previo. No se cambiaron secretos.
- Incidencias operativas: se interrumpió una construcción inicial para conservar el correo público previo. La imagen intermedia v63 incluyó dos audios sin seguimiento que aparecieron durante la construcción; no estaban referenciados por el código. Se sustituyó por v64 desde snapshot Git, y `ls /app/public` por SSH confirmó su ausencia. Los archivos locales se conservaron.
- Rollback: desplegar `registry.fly.io/ucomenu-staging:personal-sucursal-a14dded` (v62) y dejar la migración aditiva; volver primero a la app anterior según el procedimiento de recuperación de esta ficha.
- HTTP final contra v64: `/`, `/login`, `/privacidad` y `/m/la-bestia/centro` 200; `/panel/demo/sucursales` y `/sala/demo/mesas` 307 sin sesión; `/sala/demo/estado` y `/cocina/demo/estado` 401. Privacidad conserva el correo de prueba previo. DNS y smoke/health checks de Fly aprobados.
- Pendiente: prueba manual con sesión real del usuario. No se repitieron suites locales sin cambios de código; se reconstruyó el artefacto de despliegue. Producción no se tocó.

## (C) Invariantes
- El total consumido no incluye propina y nunca cambia por esta configuración.
- La lectura pública de pedidos sigue exclusivamente en `get_table_account`, solo service_role y tras verificar la visita en servidor.
- Escritura con cliente de sesión, rol Dueño y RLS vigente; aislamiento por organización y permiso solo sobre la columna nueva.
- Aritmética exacta en centavos, sin resultados fuera del rango entero seguro.

## (C) Fallos y recuperación
- Fallo de guardado o cero filas: informar error, sin confirmar éxito. Fallo de lectura: error existente, sin inventar porcentaje.
- Desactivar por sucursal quita inmediatamente la sugerencia al volver a consultar. Orden de despliegue autorizado en el futuro: aplicar la migración primero y desplegar la app después; el código nuevo contra una base vieja falla cerrado al consultar la cuenta.
- Rollback operativo: volver primero a la imagen anterior de la app y conservar la columna y función aditivas; el código anterior ignora el campo nuevo. No restaurar el cuerpo antiguo de `get_table_account` mientras se sirva código nuevo. No hace falta borrar datos ni columnas. Local: revertir incremento y reset de base de pruebas.

## (C) Revisión y aprobación
- Usuario aprobó desarrollar el alcance propuesto el 2026-10-26. Revisión independiente de Claude sobre `ad2e3cb`: **APROBAR**, informe `output/revisiones/claude-0fb42a42-9bb5-4574-84ae-cf0eaf8cd7bb.md`. Solo lectura, sin suites ni capturas propias del revisor.
- Se incorporaron sus sugerencias H1 (orden de despliegue y rollback compatible) y H2 (BOM de ahora.md y referencia cruzada desde ADR 0041). Sin cambios funcionales posteriores a la revisión; no amerita otra ronda.
- Push y migración/despliegue de staging aprobados posteriormente el 2026-10-26 con el pedido citado arriba; no incluye producción.
