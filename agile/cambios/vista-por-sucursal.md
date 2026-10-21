# Cambio: Vista por sucursal de cada persona (sala, avisos, push y estadísticas)
Estado: **para verificar** — implementado y probado en local; falta la revisión de Codex y la aprobación humana
Nivel: C (cambia `push_targets_for_call`, una función `SECURITY DEFINER` que decide a quién se le manda información de llamados; suma una tabla y dos RPC con `EXECUTE` para `authenticated`; un error puede dejar llamados sin avisar). No cambia la autorización: ver decisión 1.

## Objetivo
Con dos sucursales que reciben llamados a la vez, hoy todo el personal ve y recibe todo mezclado (sala, cartel del panel, contador del menú, sonido y push). Que **cada persona (Dueño o Staff) elija qué sucursal(es) mira** y que la sala, el cartel, el sonido y el aviso push de sus dispositivos sigan esa elección; las estadísticas siguen siendo solo del Dueño pero abren en la sucursal que eligió. [ADR 0034](../../docs/decisiones/0034-vista-por-sucursal.md).

## Decisiones
1. **Es una preferencia de la persona, no un permiso.** La membresía sigue siendo por organización (ADR 0004/0005): por la API cualquier miembro lee y atiende los llamados de cualquier sucursal. La versión «el Dueño asigna sucursales al Staff, con restricción real» (RLS de `waiter_calls`/`tables`/push) queda fuera de alcance y este diseño no la bloquea.
2. **Dónde vive.** Tabla `member_branch_views (user_id, organization_id, branch_ids)`: una fila por persona y local (vale para todos sus dispositivos), FK a `memberships` con `ON DELETE CASCADE`, sin permisos ni políticas (como `push_subscriptions`). Dos RPC: `set_my_branch_view` (valida que los ids sean sucursales activas de ese local; vacío = «Todas») y `my_branch_view` (la vista **efectiva**: lo guardado ∩ sucursales activas; si queda vacío vuelve a «Todas»).
3. **«Todas» es el valor por defecto y la salida de toda ambigüedad.** Sin fila, con la lista vacía o con sucursales que ya no están activas, se ve y se avisa de todo. Preferible un aviso de más que un llamado perdido.
4. **Push.** `push_targets_for_call` agrega la sucursal de la mesa y descarta las suscripciones de quien eligió otras sucursales (y solo esas). No devuelve datos nuevos y solo puede **reducir** destinatarios.
5. **Sala y cartel.** `loadSala` filtra por la vista efectiva y devuelve además `branches`, `view` y `othersPending`. `multiBranch` sigue siendo del local (la tarjeta nombra la sucursal aunque se filtre a una, igual que el texto del push). El cartel del panel, el contador del menú y el sonido heredan el filtro porque salen del mismo sondeo.
6. **Red de seguridad.** La sala muestra una línea fija **no viva** «Hay N llamados pendientes en otras sucursales» con «Ver todas», y el cartel dice «Mostrando: …».
7. **Qué anuncia un cambio de vista** (`announceableCalls`, función pura): lo que la pantalla **ya había recibido** y la vista anterior ocultaba es base y no suena ni se anuncia; un llamado creado **después de la última actualización** nunca se mostró en ningún lado y sí se anuncia, aunque la vista anterior lo ocultara. Todo con horas del servidor (`createdAt` contra el `serverNow` de la actualización anterior): no depende del reloj del dispositivo, del momento del toque ni de respuestas intermedias. Ante la duda se anuncia. El cartel del panel vuelve a montar su región viva al cambiar la vista. La elección se ve y se usa al instante (el segundo toque se suma al primero aunque el sondeo tarde).
8. **Analítica** (solo Dueño, sin cambios de permisos): sin `?sucursal=` abre en la vista guardada si es exactamente una sucursal; `?sucursal=_todas` fuerza «Todas» (valor reservado: el guion bajo no puede formar parte de un slug, y una sucursal puede llamarse «todas»).
9. **No cambian:** RLS de `waiter_calls`/`tables`, `attendCall`, el service worker, mesas y configuración del llamado (tareas de administración).

## Aceptación
- [ ] Cada persona elige una, varias o todas las sucursales; la elección persiste (recarga y otros dispositivos) y solo existe si el local tiene más de una sucursal activa.
- [ ] La sala, el cartel, el contador y el sonido muestran solo lo elegido; «otras sucursales» se informa con un número y un enlace.
- [ ] Cambiar la vista no hace sonar ni anuncia llamados que la pantalla ya había recibido; uno creado desde la última actualización sí.
- [ ] El push de un llamado llega a quien eligió esa sucursal o «Todas» y no a quien eligió otra; sin vista, o con una vista sin sucursales activas, avisa.
- [ ] Nadie escribe la vista de otra persona ni con sucursales de otro local o inactivas; quitar a la persona del local borra su vista.
- [ ] La analítica del Dueño abre en la sucursal guardada.

## (C) Invariantes
1. Sin vista guardada todo funciona como hoy.
2. La vista efectiva nunca deja a nadie sin ver nada por sucursales desactivadas o borradas.
3. Elegir sucursal no amplía ni reduce permisos.
4. Solo la propia persona escribe su vista, y solo con sucursales activas de ese local.
5. El push nunca avisa a quien no es miembro y, ante ambigüedad, avisa.
6. Cambiar la vista no dispara sonido ni anuncio por llamados que la pantalla ya había recibido; un llamado nuevo, aunque la vista anterior lo ocultara, sí se anuncia.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| No se puede leer la vista (error de la base) | La sala falla como cualquier lectura (503 y reintento); nunca se filtra «a ciegas». |
| No se puede guardar la vista | Se informa y la vista anterior sigue; el sondeo siguiente muestra la real. |
| Una sucursal elegida se desactiva o se borra | La vista efectiva la ignora; si no queda ninguna, vuelve a «Todas». |
| La persona se olvida de que filtró | La línea «en otras sucursales» y «Mostrando: …» lo muestran; «Todas» es un toque. |
| Migración mal aplicada | Rollback en la cabecera de `20261106100000_vista_por_sucursal.sql` (restaurar la función anterior y retirar funciones y tabla). |

## Alcance / fuera de alcance
Incluye: migración, `loadSala`/`parseSalaState`, selector y acción, cartel y contador, analítica, pruebas, ADR 0034 y las aclaraciones de `producto.md` y `arquitectura.md`. No incluye: asignación de sucursales con restricción real, estadísticas para el Staff, filtrar mesas ni la configuración del llamado.

## Revisión y aprobación
- **Codex, ronda 1 (commit `ea42df4`, nivel C, esfuerzo high): APROBAR CON CAMBIOS, 3 hallazgos importantes, los tres confirmados.** (1) Un segundo toque, antes de que el sondeo devolviera la primera elección, calculaba sobre la vista vieja y la pisaba: la elección se muestra y se usa al instante (`pendingView`) y solo la reemplaza una respuesta posterior al guardado. (2) `?sucursal=todas` chocaba con una sucursal cuyo slug sea `todas`: el valor reservado pasó a `_todas`. (3) El cartel del panel seguía anunciando en su región viva los pendientes que aparecían al cambiar la vista: ahora la región se vuelve a montar con la vista nueva. De paso, al refinar la prueba de sonido apareció una carrera real (un llamado creado mientras se guarda el cambio se tomaba como ya pendiente): solo lo anterior al cambio es base. Se agregaron 3 pruebas E2E (con mutación) y se endureció la de la analítica, que verificaba antes de que terminara la navegación.
- **Codex, ronda 2 (verificación, commit `a27f8bb`): APROBAR CON CAMBIOS, 2 hallazgos importantes sobre mi corte por reloj del dispositivo, ambos reproducidos.** (1) Con latencia, el corte (hora del cliente convertida con el desfase del servidor) podía quedar antes de un llamado previo al toque y anunciarlo; (2) una respuesta intermedia consumía el corte del segundo toque y el llamado nuevo de Centro quedaba como base, sin sonido. Los tres hallazgos de la ronda 1 se dieron por corregidos. Se reemplazó el corte por una regla de **horas del servidor sin estado compartido** (decisión 7), extraída a `announceableCalls` con pruebas unitarias de ambas secuencias. Con esa regla, un llamado creado entre la última actualización y el toque se anuncia aunque lo ocultara la vista anterior (nunca se había mostrado): es la decisión de «ante la duda, avisar».
- Pendiente: ronda 3 de verificación, y la **aprobación humana** (no está dada) antes de subir a `origin`, aplicar la migración en staging o desplegar.

## Evidencia
Local, 2026-10-21, sobre el árbol sin commitear de esta ficha (el commit probado se anota en «Revisión»), con `pnpm db:reset` y la migración nueva:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` **748/748** (nuevas: `vista.test.ts`, la lectura de la vista en `sala.test.ts`).
- `pnpm test:rls` completo **921/921** en 41 archivos. Nuevas: 13 en `vista-sucursal.rls.test.ts` (guardar y leer lo propio, ajeno/anon, sucursales de otro local, inactivas, repetidas o inexistentes, tabla sin acceso por la API, vista efectiva con sucursales desactivadas, cascada al quitar a la persona; el push avisa solo a quien mira la sucursal de la mesa o «Todas», «ante la duda avisa», sin cruzar locales; la sala filtra y cuenta `othersPending`; elegir no cambia lo que el Personal lee ni atiende por la API; un local con una sola sucursal) y 1 en `acl.rls.test.ts` (+ la matriz de funciones).
- E2E completo (`--workers=1`, contra el build, sobre `ea42df4`): **351 pasaron, 1 omitida** (preexistente: requiere servidor de desarrollo; una corrida previa tuvo 1 fallo esperado por el contrato nuevo de `/estado`, ajustado); tras las correcciones de la revisión, `sala`, `analitica`, `panel-llamados-aviso`, `llamados`, `sala-push` y `panel-push`: **78/78** y `pnpm test` **748/748**. Nuevas (7 en `sala.spec.ts`): el Dueño y el Personal eligen por separado, la sala, el aviso y el título siguen a cada uno, persiste al recargar y en otra sesión, «Ver todas»; cambiar de sucursales no suena ni anuncia lo ya pendiente y un llamado nuevo de lo que se mira sí; el cartel del panel («Mostrando: Norte») y la analítica siguen la elección; con una sola sucursal no hay selector.
- **Mutaciones** (restauradas): push que avisa siempre (2 pruebas fallan), sin «ante la duda» (1), `set_my_branch_view` que acepta cualquier sucursal (1), vista efectiva con inactivas (1), `loadSala` sin filtro (2), y `SalaBoard` sin reiniciar la base al cambiar de vista (el E2E de sonido falla: un pitido de más).
- **No verificado / límites:** el aviso push real en un teléfono (solo la función de destinos contra la base local y los dobles del envío); lector de pantalla; Safari/iOS y Firefox. La analítica por defecto en la sucursal elegida se prueba en E2E pero no con datos de vistas.
