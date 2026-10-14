# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code (worktree `../UcoMenu-precios`)
- **Objetivo actual:** «Historial de cambios de precio» (`price_history`) implementado y verificado en una instancia Supabase **aislada** en `feat/historial-precios`; falta correrlo contra la base compartida (ventana exclusiva), la revisión de un segundo agente y que el usuario confirme los borrados (ADR 0010, propuesta). Sin integrar, sin push
- **Rama / último commit:** `feat/historial-precios`, **base `da20ffd`** (`main` local: gestión de carta + mesas y QR; `origin/main` está atrasada en `0f468a4`). Ver `git log`. Este archivo describe SOLO esta rama: otros dos agentes trabajan en «Llamado desde la mesa» (`feat/llamado-desde-la-mesa`) y «Diseño gastronómico de la carta» (`feat/diseno-carta`) y al integrar habrá que reconciliar `ahora.md`
- **Nivel:** C
- **Ficha relevante:** `agile/cambios/historial-de-precios.md` · ADR 0010 · antes: `agile/cambios/mesas-y-qr.md` (ADR 0009) y `agile/cambios/gestion-de-carta.md` (ADR 0008)

## Estado
- En `main`: esqueleto caminante, núcleo multi-tenant, planes y entitlements, acceso del personal y gestión de carta. Los cinco pasaron revisión de Codex (solo lectura). En la rama: mesas y QR.
- Gestión de carta: `/panel/{slug}/carta` (categorías y platos: alta, edición, subir/bajar, activar/desactivar; Dueño y Staff), `/carta/platos/nuevo` y `/carta/platos/{id}` (datos y foto), «Platos activos: X de N» con el mensaje del tope `53400`, formularios deshabilitados con el motivo en solo lectura y suspendida y acciones forzadas sin éxito falso, foto en la carta pública. **Fotos en Supabase Storage** (bucket público `product-images`, ruta por organización, escritura con `org_can_write`; ADR 0008); el navegador reduce la foto antes de subirla. **No hay borrado** de categorías ni platos (se desactivan).
- Mesas y QR: `/panel/{slug}/mesas` (alta de a una por sucursal, renombrar, activar/desactivar, regenerar QR con confirmación, «Mesas activas: X de N» y el mensaje del tope; Dueño y Staff), `/panel/{slug}/mesas/imprimir/{sucursal}` (hoja A4 con 6 tarjetas, solo mesas activas; se abre aunque la cuenta esté bloqueada) y `/t/{token}` (carta con «Mesa N»; mesa inactiva = carta sin número; desconocido o regenerado = 404; suspendida = «no disponible»). Token de 32 hex generado por la base; regenerar = tocar `qr_token` (trigger); `anon` no lee `tables`, solo `resolve_table_qr(token)`. Sin borrado de mesas. QR dibujado en el servidor con `qrcode-generator` 2.0.4 (aprobada). ADR 0009.
- Historial de precios (rama aparte): tabla `price_history` por trigger `AFTER UPDATE OF price_cents` en la misma transacción; `changed_by` = `auth.uid()` o NULL (operación técnica); solo se agrega (ni API ni `service_role` ni el dueño de la tabla); lectura de Dueño y Staff de su organización; organización con historial no se borra (`RESTRICT`), plato y persona sin clave foránea. La pantalla de consulta no está.
- Falta: llamados, SuperAdmin (`platform_admins`, pagos, auditoría), variantes y adicionales, pantalla del historial de precios, borrado de la carta y de las mesas.
- GitHub: `main` subido con la gestión de carta (0f468a4); la rama de mesas no se subió.

## Pruebas de esta rama (2026-10-14, instancia aislada `ucomenu-precios`, puertos 55420–55429; la base compartida NO se tocó)
- typecheck · lint OK · unitarias 107/107 · RLS 322/322 (286 + 35 de `price-history` + 1 de permisos en `acl`) con tiempos de prueba de 90 s; con los de 5 s por defecto fallan por tiempo agotado 5 pruebas de concurrencia de `owners`/`personnel` (sin relación con precios) y `catalog` por las organizaciones que esas fallas dejan.
- Mutaciones: 15 defensas de `price_history` rotas de a una, 15 detectadas.
- **No ejecutado:** RLS ni E2E contra la base compartida; `pnpm build` y E2E (sin cambios de interfaz; el cleanup de E2E deja locales de prueba si se editaron precios, ver la ficha); `pnpm db:types` (los tipos se editaron a mano con el formato del generador); revisión de un segundo agente.
- La instancia aislada se levantó con `supabase start --workdir <carpeta temporal>` (config copiada con otro `project_id`); se apaga con `supabase stop --workdir <carpeta>`. Las pruebas usan `SUPABASE_DB_CONTAINER=supabase_db_ucomenu-precios`.

## Pruebas de `feat/mesas-y-qr` (ya en `main`)
- typecheck · lint · build OK · unitarias 107/107 · RLS 286/286 · E2E 86/86; mutaciones: 46 de 51 detectadas y 5 equivalentes (ver su ficha). Codex sobre `3057b41`: aprobar con cambios; el P2 se corrigió con E2E del recorrido.
- **No ejecutado: escanear un QR impreso con un teléfono real** (el entorno no tiene decodificador; la URL, la matriz, el nivel de corrección M y la zona de silencio sí están verificados), impresión en papel, `pnpm dev` de punta a punta, Safari/iOS y cámara del celular, fotos HEIC, lector de pantalla, rendimiento con fotos, bucket en Supabase Cloud, renovación automática del token por el proxy, revisión de Codex sobre mesas.

## Para usar la app en local
- **Tras actualizar a esta rama: `pnpm db:reset`** (migración de mesas y mesas de ejemplo con tokens fijos, p. ej. `/t/c0ffee01000000000000000000000000` es la Mesa 1 de Café Ejemplo) y `pnpm install` (nueva dependencia `qrcode-generator`). Si venís de antes de la gestión de carta: `pnpm db:stop` y `pnpm db:start` (arranca `storage-api`).
- Usuarios del seed (contraseña pública de desarrollo `ucomenu-dev-2026`): `dueno@cafe-ejemplo.test`, `mozo@cafe-ejemplo.test`, `dueno@parrilla-demo.test`, `mozo@parrilla-demo.test`, `dueno@resto-moroso.test`, `mozo@resto-moroso.test`, `multi@ucomenu.test` (Dueño en Café Ejemplo y Personal en Parrilla Demo).
- `SUPABASE_SERVICE_ROLE_KEY` (clave del Supabase LOCAL) ya está en `.env.local` por autorización del usuario; `.env.local` y `.env.test.local` están ignorados por Git.
- Tras cambiar `supabase/config.toml` hay que `pnpm db:stop` y `pnpm db:start`.

## Decisiones recientes
- Organización activa en la URL; identidad por `getUser()`; rol por `memberships` en cada pedido; cada página y acción exige su nivel (los layouts no se re-ejecutan).
- `service_role` solo en el módulo de personal; la carta escribe con el cliente de la persona (RLS), nunca con `service_role`.
- Estado de mora derivado, bordes inclusivos; en solo lectura y suspendida no se escribe catálogo (tampoco fotos).
- Carta: desactivar es la baja (sin borrado); precio en centavos enteros, tope $ 10.000.000; fotos JPG/PNG/WebP hasta 2 MB validadas por bytes (ADR 0008).

## Bloqueos y riesgos
- Producción: apagar el registro público y fijar la contraseña mínima de 10 en Supabase Cloud; verificar el bucket `product-images`; **definir `NEXT_PUBLIC_SITE_URL`** con el dominio definitivo (si no, el QR impreso apunta al dominio desde el que se abrió el panel). Todo en el checklist de «Salida a producción».
- El historial de precios solo existe desde esta rama: hasta integrarla, el Staff cambia precios sin registro. Una organización con historial no se puede borrar (`RESTRICT`) hasta decidir retención/purga; los E2E que editan precios dejan su local de prueba sin borrar (slug aleatorio).
- **El proxy conserva solo el camino al mandar al login y `safeNext` solo acepta caminos:** una ruta que necesite un dato para renderizar debe llevarlo en el camino, no en una query (aprendido con el P2 de la hoja de QR). `/carta/platos/nuevo?categoria=` pierde la categoría preseleccionada si hubo login en el medio (cosmético).
- Un QR fotografiado sirve desde afuera del local: se mitiga regenerando y, en el ítem del llamado, con cooldown y límites; quien lo escriba debe resolver el token con `resolve_table_qr`, nunca leyendo `tables` con `anon`.
- Sin cuota de almacenamiento por organización; archivos huérfanos acotados a fallas a mitad de camino; las fotos de una organización suspendida siguen accesibles por URL directa.
- Contraseña temporal sin cambio forzado; sin recupero por correo; restablecer no revoca sesiones abiertas.
- `org_is_published` se evalúa por fila: medir en «Rendimiento de la carta pública» (las fotos hoy se sirven sin optimizar).
- `service_role` puede dejar una suscripción incoherente; la auditoría llega con «SuperAdmin».
- Un `UPDATE`/`DELETE` (y un `remove` de Storage) bloqueado afecta 0 filas sin error: toda escritura nueva debe confirmar las filas afectadas.
- `limits.rls.test.ts` deja un usuario `rls-fuga-otra-org-*` por corrida (preexistente: la guarda del último Dueño frena su borrado); limpiarlo con `delete from auth.users where email like 'rls-%'`.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`; `pnpm build` antes de `test:e2e`; `pnpm test:rls` y `test:e2e` comparten base: no correrlos a la vez; un *worker* de Vitest o de Playwright murió a veces con `0xC0000409` (pasa al repetir).

## Próxima acción probable
0. **Historial de precios:** coordinar una ventana exclusiva en la base compartida (`pnpm db:reset`, `pnpm db:types`, `pnpm test:rls`, `pnpm build` + `pnpm test:e2e`), confirmar los borrados del ADR 0010 y pedir una ronda de revisión de solo lectura antes de integrar. Al integrar: reconciliar `database.types.ts`, `supabase/seed.sql`, `tests/rls/acl.rls.test.ts` y este archivo con las ramas de llamados y de diseño de carta.
1. Escanear con un teléfono un QR impreso desde `/panel/{slug}/mesas/imprimir/{sucursal}` (levantar `pnpm dev` o `pnpm build` + `pnpm start` y abrirlo por la IP de la red local con `NEXT_PUBLIC_SITE_URL` apuntando a ella) y confirmar que abre la carta con «Mesa N».
2. Pedir a Codex que confirme la corrección del P2 (ronda corta, solo lectura) e integrar `feat/mesas-y-qr` a `main` y subirla.
3. Siguiente ítem: «Llamado desde la mesa» (nivel C, desbloqueado por este ítem) o el historial de precios (S).

## Estado del worktree al cerrar
- Rama `feat/historial-precios` en `../UcoMenu-precios` con el trabajo confirmado en commits locales; `git status` limpio. `node_modules` es un enlace (junction) al del checkout principal, ignorado por Git: no se instaló nada. La instancia aislada se apagó al terminar (la carpeta temporal con su config no está en el repo; se recrea copiando `supabase/` con otro `project_id` y puertos).
