# Cambio: Pantalla del historial de precios
Estado: **hecho e integrado a `main` (2026-10-14, squash `cbf19cd`, sin `push`)** — Codex aprobó con cambios en dos rondas, corregidos; la rama `feat/pantalla-historial-precios` sigue existiendo (borrable con `git branch -D`, porque el squash no la deja «fusionada» para Git)
Nivel: **M** (solo lectura, sin migración; toca dinero y permisos, así que las pruebas incluyen aislamiento entre locales y entre roles)
Rama: `feat/pantalla-historial-precios` (desde `main` `3104459`, integrada por squash; borrable)

## Objetivo
Que el Dueño y el Staff vean, dentro del panel, los cambios de precio que la base ya registra (`price_history`, ADR 0012): qué plato, de cuánto a cuánto, cuándo y quién. Cierra la mitigación declarada en `arquitectura.md` («el Dueño y el Staff pueden consultar los cambios»).

## Lo verificado (código y docs)
- `price_history` guarda organización, `product_id`, `changed_by`, `changed_at`, precio anterior y nuevo en centavos. Índices por `(product_id, changed_at desc)` y `(organization_id, changed_at desc)`.
- Lectura por RLS: miembros (Dueño y Staff) de la propia organización; `anon` nada; vale también con la cuenta en solo lectura o suspendida.
- `product_id` y `changed_by` **no tienen clave foránea**: PostgREST no puede unir; hay que traer los platos y las personas aparte. El plato puede haber sido borrado; la persona, dada de baja. `changed_by` NULL = operación técnica no identificada.
- «Local» en la interfaz = organización; la carta es una por organización (los platos no pertenecen a una sucursal), así que «por local» es «de toda la organización».
- `memberships` solo la lee su titular o el Dueño de la organización (el Staff no ve a los demás). No existe nombre de persona: la única identidad legible es el email de Auth, al que hoy solo accede el módulo de personal con `service_role` (`listMembers`, con comprobación previa de Dueño).
- Patrón de páginas: `requireMembership` + `createSessionClient` (RLS), como `carta/page.tsx`; el *proxy* conserva solo el camino al ir al login, así que lo que la página necesite para renderizar debe ir en el camino y no en la query (lección de la hoja de QR).
- Seed: 4 filas de ejemplo (Café Ejemplo: Espresso por Staff y por Dueño, Flat white técnica; Parrilla Demo: Entraña por Staff).

## Decisión del usuario (2026-10-14): opción 2 elegida
**¿Cómo se muestra quién hizo el cambio?** No hay nombres; solo el email, que hoy ve únicamente el Dueño en «Personal».
1. **Solo lo propio** (sin código sensible): «Vos», «Otra persona del equipo» y «Operación técnica (sin usuario)». El Dueño no puede distinguir a dos Staff, lo que debilita la auditoría.
2. **ELEGIDA — el Dueño ve el email, el Staff no:** Dueño: email de quien sigue en este local (rol actual entre paréntesis); «Persona que ya no está en el local» si fue dada de baja o ya no es miembro de este local (**nunca** se resuelve el email de alguien que ya no pertenece a esta organización). Staff: «Vos» / «Otra persona del equipo». Usa el mismo camino del módulo de personal (comprobación de Dueño antes de `service_role`).
3. **Dueño y Staff ven los emails de todos:** exige una función o vista nueva en la base y es una decisión de privacidad que no está tomada; descartada salvo que lo pidas.

## Alcance propuesto
- **Incluye**
  - `/panel/{slug}/historial-de-precios`: lista de todo el local, del más nuevo al más viejo, 50 por página con «Ver más» (por el camino o la query de paginación; es cosmético).
  - `/panel/{slug}/carta/platos/{id}/historial`: lo mismo para un plato (lo muestra el plato aunque esté inactivo; si el plato fue borrado, la pantalla por plato responde 404 y la lista del local lo marca «Plato eliminado» sin enlace).
  - Enlaces desde la carta («Historial de precios») y desde la edición de cada plato.
  - Cada fila: plato (nombre actual, o «Plato eliminado»), precio anterior → nuevo con la diferencia (sube/baja, con texto, no solo color), fecha y hora (es-AR, zona horaria de Argentina), quién según la decisión de arriba.
  - Estado vacío, error de lectura (fallar cerrado, sin mostrar vacío falso) y tolerancia a la cuenta en solo lectura o suspendida.
  - Datos de ejemplo: ya están en el seed.
- **No incluye:** migración ni cambio de esquema; escritura de cualquier tipo; filtros por fecha o persona; exportar; variantes y adicionales; borrado de la carta; purga del historial.

## Comportamiento y aceptación
- [x] Dado el Dueño o el Staff de Café Ejemplo, cuando abre el historial del local, entonces ve las 3 filas de Café (Espresso ×2, Flat white), la más nueva primero, con precio anterior → nuevo en pesos y fecha; no ve la de Parrilla Demo.
- [x] Cuando abre el historial de Espresso, ve solo sus 2 cambios; con el id de un plato de otro local obtiene 404 (idéntico al de un id inexistente), sin pista de que existe.
- [x] Un cambio con `changed_by` NULL se muestra como operación técnica; un cambio de un plato borrado muestra «Plato eliminado» sin enlace; uno de una persona dada de baja o que ya no es del local nunca revela su email.
- [x] La identificación de la persona cumple la opción elegida (con la 2: el Staff nunca recibe emails en el HTML ni en los datos de la página).
- [x] Con la cuenta en solo lectura o suspendida la pantalla se abre; un mozo/Staff de otro local, una persona sin sesión (redirige al login y vuelve) y un usuario sin membresía no acceden.
- [x] Sin cambios todavía: mensaje de estado vacío. Si la lectura falla: aviso de error, no «sin cambios».
- [x] Más de 50 cambios: la primera página trae 50 y «Ver más» trae los siguientes sin repetir ni saltar filas con el mismo instante.
- [~] Accesible y móvil (390 px): emails y nombres de plato larguísimos se parten sin desborde (E2E con medida directa y captura revisada a 390 px), «Sube/Baja» en texto, enlaces y botones con `min-h-11`. **No comprobado:** lector de pantalla, teléfono real.

## Dependencias y riesgos
- Depende de `price_history` (ADR 0012) y de `requireMembership`/`createSessionClient`; no cambia ninguno.
- Riesgo principal: **filtrar datos de personas** (emails) a quien no corresponde → pruebas adversarias (Staff, otro local, persona dada de baja). Segundo: sin FK, un id de plato de otro local no debe filtrar nada (la RLS ya lo resuelve por `organization_id`; la consulta de platos también va por RLS).
- Orden estable: empates en `changed_at` se desempatan por `id`.

## Evidencias de verificación
- Contra la base compartida local (`ucomenu`), sobre la rama `feat/pantalla-historial-precios` (base `915b4f5`), con `pnpm build` previo:
  - `pnpm test` **187/187** (36 nuevas en `src/lib/precios/historial.test.ts`) · `pnpm typecheck` OK · ESLint sobre `src tests e2e` sin hallazgos.
  - `pnpm test:rls` **386/386** en 16 archivos (16 nuevas en `tests/rls/price-history-screen.rls.test.ts`: aislamiento entre locales, paginación con empates y fila nueva a mitad de recorrido, plato eliminado, `resolveAuthors` contra Staff, Dueño de otro local, ex miembro, persona de otro local, Dueño de dos locales, falla de Auth).
  - `pnpm test:e2e` **129/129** (8 nuevas en `e2e/historial-precios.spec.ts`: roles y emails, baja y plato eliminado, vacío y cuenta suspendida, paginación y cursor inválido, historial por plato, 404 uniforme, acceso).
  - **Mutaciones (10, de a una, todas detectadas):** plato sin filtro de organización (RLS y E2E); el Staff recibe email; cursor sin desempate por id; cursor sin validar el instante; `resolveAuthors` sin comprobar Dueño; `resolveAuthors` sin filtro de organización (**sobrevivió** hasta agregar la prueba del Dueño de dos locales); `resolveAuthors` que traga fallas de Auth.
- **Revisión de Codex (solo lectura, sobre `4a5efee`): aprobar con cambios.** (1) *Importante:* un email largo desbordaba en móvil → `[overflow-wrap:anywhere]` en la línea del autor, la del cambio y el nombre del plato, con captura a 390 px revisada. (2) *Sugerencia:* el cursor aceptaba instantes imposibles (30 de febrero, hora 25, desfase +99:99), que la base rechaza y mostraban el error → `parseCursor` valida que el instante exista (11 casos nuevos) y el E2E comprueba que se ve la primera página. Corregido en `d36d616`; mutación de la corrección de desborde detectada.
- **Segunda revisión de Codex (sobre `2fd7fca`): aprobar con cambios.** Confirmó el desborde y las fechas imposibles; quedaba el límite del desfase: el parser aceptaba hasta `+23:59` pero PostgreSQL admite **±15:59** (comprobado: `+15:59` y `-15:59` se aceptan, `+16:00`, `-16:00` y `+23:59` dan «time zone displacement out of range»). Corregido; pruebas unitarias de los bordes y una de RLS que comprueba que todo cursor aceptado por el parser lo acepta la base. Mutación (límite 23) detectada por 3 pruebas.
- No ejecutado: `pnpm lint` global (falla por scripts sin seguimiento en `output/`, ajenos a este cambio); mutaciones de las páginas más allá de la del plato; revisión visual; lector de pantalla; teléfono real; revisión de un segundo agente.

## Aprendizajes / cambios de decisión
- **Bug real encontrado por las pruebas:** la carta pública hace legibles (RLS) los platos activos de cualquier local; sin `organization_id` en la consulta de platos, el historial de un plato **ajeno** no daba 404 y mostraba su nombre. `loadProductInfo` filtra por organización.
- La RLS de `memberships` no basta para aislar locales: un Dueño de dos locales lee las membresías de ambos. `resolveAuthors` filtra por la organización mirada (con prueba propia).
- Intl formatea con espacio duro (`$ 100`) y a las 12 h por defecto: se fijó `hourCycle: "h23"` y las pruebas normalizan espacios.
- `expectNoHorizontalOverflow` (`e2e/support.ts`) **no detecta desbordes** en la emulación móvil: el viewport crece con el contenido y `scrollWidth - innerWidth` da 0 (con el desborde real la página medía ~700 px y el helper pasaba). Esta pantalla usa una medida propia (derecha máxima de los elementos de `main` ≤ 390 px). **Pendiente fuera de alcance:** revisar ese helper y las pruebas que lo usan.
- Sin migración ni cambios de esquema; `service_role` solo consulta el email de Auth de ids que ya son miembros del local (módulo de personal).
