# Cambio: alta guiada del dueño (guía de primeros pasos en el Resumen)
Estado: implementado y verificado en local (2026-10-16), commiteado en `feat/alta-guiada-dueno`, sin integrar
Nivel: M (solo lectura de datos propios; no cambia permisos, planes, dinero ni borrados; sin esquema nuevo)

## Objetivo
El Dueño (o el Staff) de un local recién dado de alta en `/admin/nueva` caía en el Resumen sin saber qué hacer. Ahora el Resumen abre con una guía corta: **1. Cargá tu carta · 2. Agregá tus mesas · 3. Imprimí los QR**, con un botón por paso. Cuando carta y mesas están hechas la guía se resume en «Primeros pasos: completos» con atajos.

## Decisiones
1. **Sin esquema ni estado guardado:** el avance se deduce de los datos (`src/lib/guia/primeros-pasos.ts`). No hay campo «onboarding_completed»: si se borran todas las mesas, la guía vuelve a pedirlas, que es lo correcto.
2. **Qué cuenta como «carta cargada»:** al menos un plato **activo dentro de una categoría activa** (lo que el público realmente ve). Categorías sin platos, o platos apagados, no cuentan; el texto del paso explica cuál es el caso.
3. **Qué cuenta como «mesas»:** al menos una mesa **activa** (solo ésas tienen QR en la hoja).
4. **«Imprimí los QR» no es deducible** (nadie registra la impresión). Por eso no se marca nunca «Listo»: queda «Después» sin mesas y «Para hacer» con ellas. La guía se considera completa con carta + mesas, y entonces el resumen conserva el atajo «Imprimir los QR» (a la hoja de la sucursal si hay una sola con mesas; si no, a Mesas).
5. **La guía completa no desaparece**: queda como un bloque corto con atajos (decisión mía para no necesitar estado; ver pendiente 1).
6. **Cuenta en solo lectura o suspendida (o sin poder leer el estado):** los pasos pendientes figuran «En pausa», sin botones, con un aviso («Regularizá el pago desde Suscripción» al Dueño; «Avisale al dueño» al Staff, sin plan ni fechas). Imprimir los QR sigue disponible porque la ficha `mesas-y-qr` lo permite en esos estados.
7. **Plan:** el enlace «Atender llamados en Sala en vivo» del resumen solo aparece si el plan incluye `waiter_call` (no Básico) y la cuenta puede operar. No hay paso de llamados.
8. **Dueño y Staff ven la misma guía** (ambos gestionan carta y mesas, `docs/producto.md`); el «Uso del plan» sigue siendo solo del Dueño y no se tocó.
9. **Sugerencia de fotos:** si hay platos visibles sin foto, el resumen lo dice; no impide dar la guía por completa.
10. **Aislamiento:** todas las consultas filtran por `organization_id` además de RLS, para que quien pertenece a dos locales no mezcle datos.

## Aceptación
- [x] Local nuevo vacío: tres pasos con su estado en texto («Para hacer», «Después»), botón principal en el primero, sin desborde a 390 px, botones de ≥ 44 px.
- [x] Avanza al cargar datos: platos visibles → carta «Listo»; mesas activas → QR «Para hacer»; ambos → resumen con atajo a la hoja de QR.
- [x] Categoría sola, plato apagado, categoría apagada o mesas inactivas no cuentan.
- [x] Solo lectura y suspendida: sin botones de escritura, aviso por rol; imprimir sigue disponible con mesas.
- [x] Staff: misma guía, sin «Uso del plan» ni menciones de plan o suscripción.
- [x] Plan Básico sin enlace a la sala; Pro con él.
- [x] Quien pertenece a dos locales ve en cada guía solo lo de ese local.

## Fuera de alcance
- Gestión de sucursales (el panel todavía no las crea), ocultar la guía a mano, guía para varias sucursales con avance por sucursal, y registrar la impresión de los QR.

## Decisiones pendientes (para quien integra)
1. ¿El Dueño puede **descartar** la guía completa? Hoy queda un bloque corto fijo. Descartarla sin estado propio solo se puede por dispositivo (cookie); por cuenta requeriría un campo nuevo.
2. Con varias sucursales (hoy solo por script) la guía suma todas: basta con que una tenga mesas. Revisar cuando el panel gestione sucursales.

## Evidencia (2026-10-16, sobre el commit de esta rama que agrega la guía)
`pnpm lint` y `pnpm typecheck` limpios · `pnpm test` 337/337 (16 nuevas en `src/lib/guia/primeros-pasos.test.ts`) · `pnpm test:rls` completo 501/501 (sin cambios de esquema; no se agregaron pruebas de RLS) · `pnpm build` · `pnpm exec playwright test` completo 189/191 en la primera corrida; las 2 fallas fueron `worker process exited unexpectedly (0xC0000409)` en pruebas de este cambio y repetidas pasan 11/11 (`e2e/alta-guiada.spec.ts`, 390 px).
Mutación: quitar los `.eq("organization_id", …)` de `loadGuideCounts` hace fallar «quien pertenece a dos locales» (un Dueño del local vacío que también es Staff de uno lleno); restaurado y verificado.
Revisión visual a 390 px de los tres estados (vacío, completo) con capturas; sin probar en teléfono real.
