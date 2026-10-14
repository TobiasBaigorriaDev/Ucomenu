# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code
- **Objetivo actual:** «Llamado desde la mesa» (nivel C) implementado y probado en `feat/llamado-desde-la-mesa`; Codex dijo *aprobar con cambios* sobre `cd26208` (un P2 del límite por cliente, **ya corregido**); falta que lo confirme y la integración a `main`
- **Rama / último commit:** `feat/llamado-desde-la-mesa` (sale de `main` en `da20ffd`: «Mesas y QR» ya integrada, **sin subir**: `main` va 3 commits por delante de `origin/main`). Ver `git log`. Las ramas `feat/gestion-de-carta` y `feat/mesas-y-qr` quedan locales y se pueden borrar
- **Nivel:** C
- **Ficha relevante:** `agile/cambios/llamado-desde-la-mesa.md` (para verificar) · ADR 0010 · hechos antes: `agile/cambios/mesas-y-qr.md` (ADR 0009) y `gestion-de-carta.md` (ADR 0008)

## Estado
- En `main`: esqueleto caminante, núcleo multi-tenant, planes y entitlements, acceso del personal, gestión de carta y mesas y QR (los seis revisados por Codex; de «Mesas y QR» falta que confirme la corrección del P2). En la rama: llamado desde la mesa.
- Gestión de carta: `/panel/{slug}/carta` (categorías y platos: alta, edición, subir/bajar, activar/desactivar; Dueño y Staff), `/carta/platos/nuevo` y `/carta/platos/{id}` (datos y foto), «Platos activos: X de N» con el mensaje del tope `53400`, formularios deshabilitados con el motivo en solo lectura y suspendida y acciones forzadas sin éxito falso, foto en la carta pública. **Fotos en Supabase Storage** (bucket público `product-images`, ruta por organización, escritura con `org_can_write`; ADR 0008); el navegador reduce la foto antes de subirla. **No hay borrado** de categorías ni platos (se desactivan).
- Mesas y QR: `/panel/{slug}/mesas` (alta de a una por sucursal, renombrar, activar/desactivar, regenerar QR con confirmación, «Mesas activas: X de N» y el mensaje del tope; Dueño y Staff), `/panel/{slug}/mesas/imprimir/{sucursal}` (hoja A4 con 6 tarjetas, solo mesas activas; se abre aunque la cuenta esté bloqueada) y `/t/{token}` (carta con «Mesa N»; mesa inactiva = carta sin número; desconocido o regenerado = 404; suspendida = «no disponible»). Token de 32 hex generado por la base; regenerar = tocar `qr_token` (trigger); `anon` no lee `tables`, solo `resolve_table_qr(token)`. Sin borrado de mesas. QR dibujado en el servidor con `qrcode-generator` 2.0.4 (aprobada). ADR 0009.
- **Llamado desde la mesa (ADR 0010):** en `/t/{token}` una barra fija con «Llamar al mozo» y «Pedir la cuenta», solo si `resolve_table_qr` informa `calls_enabled` (mesa activa y no silenciada, plan Pro o superior, cuenta en gracia o activa). La **única puerta de escritura** es `public.create_waiter_call(token, tipo, cliente)` (definer; ningún rol de la API escribe `waiter_calls`): un pendiente por mesa y tipo (índice único parcial + lock por mesa), vencimiento a 30 min derivado (marca `expired` al llamar), cooldown de 60 s por mesa y tipo (columna `branches.waiter_call_cooldown_seconds`), límite de 30 avisos cada 10 min por identificador de cliente (HMAC de la IP armado por el servidor; nunca la IP; conteo e inserción serializados por un lock por cliente, tomado después del de la mesa), `unavailable` uniforme sin revelar la causa. La *server action* usa el cliente `anon`. Los miembros leen `waiter_calls` de su organización. Columna nueva `tables.muted_until` (sin UI).
- Falta: **panel de sala** (tiempo real, atender, su política de `UPDATE`), UI de silenciar y del cooldown, purga de `waiter_calls`, SuperAdmin (`platform_admins`, pagos, auditoría), variantes y adicionales, historial de precios, borrado de la carta y de las mesas.
- GitHub: `main` subido hasta la gestión de carta (`0f468a4`); mesas y QR y lo que sigue no se subieron.

## Pruebas (2026-10-14, base recién reseteada, sobre el código final de la rama)
- typecheck · lint · build OK · unitarias 123/123 · RLS 310/310 · E2E 104/104 (tras el P2: dos corridas completas limpias y una con un *worker* de Playwright caído con `0xC0000409`, la inestabilidad de Windows ya registrada).
- Mutaciones: 47 defensas rotas de a una, 44 detectadas y 3 equivalentes (explicadas en la ficha).
- Codex (solo lectura, nivel C) sobre `cd26208`: aprobar con cambios; el P2 (límite por cliente no atómico entre mesas) se reprodujo y se corrigió con un lock por cliente y su prueba de concurrencia.
- **No ejecutado:** confirmación de Codex del P2 del llamado y del P2 de «Mesas y QR»; **escanear un QR impreso con un teléfono real** (de «Mesas y QR»; el entorno no tiene decodificador); la barra del llamado en un teléfono real (Safari/iOS, teclado, *safe area*); la IP real detrás del hosting (`x-forwarded-for`); `pnpm dev` de punta a punta; lector de pantalla; bucket en Supabase Cloud.

## Para usar la app en local
- **Tras actualizar a esta rama: `pnpm db:reset`** (migraciones de mesas y de llamados; mesas de ejemplo con tokens fijos, p. ej. `/t/c0ffee01000000000000000000000000` es la Mesa 1 de Café Ejemplo, **de un local Básico: no muestra los botones**; para verlos pasá la suscripción a `pro`) y `pnpm install` (dependencia `qrcode-generator`). Si venís de antes de la gestión de carta: `pnpm db:stop` y `pnpm db:start` (arranca `storage-api`). `WAITER_CALL_CLIENT_SECRET` es opcional en local (ver `.env.example`).
- Usuarios del seed (contraseña pública de desarrollo `ucomenu-dev-2026`): `dueno@cafe-ejemplo.test`, `mozo@cafe-ejemplo.test`, `dueno@parrilla-demo.test`, `mozo@parrilla-demo.test`, `dueno@resto-moroso.test`, `mozo@resto-moroso.test`, `multi@ucomenu.test` (Dueño en Café Ejemplo y Personal en Parrilla Demo).
- `SUPABASE_SERVICE_ROLE_KEY` (clave del Supabase LOCAL) ya está en `.env.local` por autorización del usuario; `.env.local` y `.env.test.local` están ignorados por Git.
- Tras cambiar `supabase/config.toml` hay que `pnpm db:stop` y `pnpm db:start`.

## Decisiones recientes
- Organización activa en la URL; identidad por `getUser()`; rol por `memberships` en cada pedido; cada página y acción exige su nivel (los layouts no se re-ejecutan).
- `service_role` solo en el módulo de personal; la carta escribe con el cliente de la persona (RLS), nunca con `service_role`.
- Estado de mora derivado, bordes inclusivos; en solo lectura y suspendida no se escribe catálogo (tampoco fotos).
- Carta: desactivar es la baja (sin borrado); precio en centavos enteros, tope $ 10.000.000; fotos JPG/PNG/WebP hasta 2 MB validadas por bytes (ADR 0008).
- Mesas: token de 32 hex generado por la base, regenerar = tocar `qr_token`, `anon` no lee `tables` (ADR 0009).
- Llamado: función abierta a `anon` + identificador de cliente como parámetro (**decisión del usuario**: el límite por IP se puede eludir llamando a la API directo; el tope duro es por mesa); cooldown por mesa y tipo y tope de 30 avisos cada 10 min **confirmados por el usuario** (ADR 0010).

## Bloqueos y riesgos
- **Hay otros *worktrees* con trabajo en paralelo** (`git worktree list`): `../UcoMenu-carta` (rama `feat/diseno-carta`: diseño visual de la carta pública, bajo `src/components/menu/`) y `../UcoMenu-precios` (rama `feat/historial-precios`), ambos con base en `main` `da20ffd`, **sin integrar** (según sus notas). **Se solapan con esta rama** en `src/app/t/[token]/page.tsx` (el llamado envuelve la carta en `pb-32` y suma la barra `fixed z-20 max-w-xl`; la carta usa `max-w-5xl` y una navegación `sticky z-10`), `menu-header.tsx` (la etiqueta de «Mesa N») y `public-menu-view.tsx`. Quien integre segundo resuelve el solapamiento y vuelve a correr los E2E de `/t/{token}` y `llamados`.
- **`NEXT_PUBLIC_SITE_URL` definida en el shell** (p. ej. para probar el QR con el celular) altera el QR impreso y, si se corre `pnpm test` sin cuidado, rompía dos pruebas de `mesas.test.ts` y la de la hoja imprimible: ya no (las pruebas la toleran, con y sin la variable; ojo: Next la fija al **compilar**, así que hay que volver a correr `pnpm build` al cambiarla).
- La carpeta `.playwright-mcp/` (salidas del navegador automatizado) aparece en el checkout original; está ignorada en `.gitignore` y se puede borrar.
- Producción: apagar el registro público y fijar la contraseña mínima de 10 en Supabase Cloud; verificar el bucket `product-images`; **definir `NEXT_PUBLIC_SITE_URL`** con el dominio definitivo (si no, el QR impreso apunta al dominio desde el que se abrió el panel). Todo en el checklist de «Salida a producción».
- El Staff cambia precios sin historial hasta que exista `price_history` (decisión ya aprobada; ítem S desbloqueado).
- **El proxy conserva solo el camino al mandar al login y `safeNext` solo acepta caminos:** una ruta que necesite un dato para renderizar debe llevarlo en el camino, no en una query (aprendido con el P2 de la hoja de QR). `/carta/platos/nuevo?categoria=` pierde la categoría preseleccionada si hubo login en el medio (cosmético).
- Un QR fotografiado sirve desde afuera del local: se mitiga regenerando, con el cooldown y el pendiente único (y, cuando exista su UI, silenciando la mesa); toda escritura pública futura debe seguir el patrón de ADR 0010 y resolver el token con la función, nunca leyendo `tables` con `anon`.
- **Dato derivado de la IP:** `waiter_calls.client_key` (HMAC) se conserva hasta que exista la purga; falta definir `WAITER_CALL_CLIENT_SECRET` en producción y citarlo en los textos legales (ley 25.326).
- Sin cuota de almacenamiento por organización; archivos huérfanos acotados a fallas a mitad de camino; las fotos de una organización suspendida siguen accesibles por URL directa.
- Contraseña temporal sin cambio forzado; sin recupero por correo; restablecer no revoca sesiones abiertas.
- `org_is_published` se evalúa por fila: medir en «Rendimiento de la carta pública» (las fotos hoy se sirven sin optimizar).
- `service_role` puede dejar una suscripción incoherente; la auditoría llega con «SuperAdmin».
- Un `UPDATE`/`DELETE` (y un `remove` de Storage) bloqueado afecta 0 filas sin error: toda escritura nueva debe confirmar las filas afectadas.
- `limits.rls.test.ts` deja un usuario `rls-fuga-otra-org-*` por corrida (preexistente: la guarda del último Dueño frena su borrado); limpiarlo con `delete from auth.users where email like 'rls-%'`.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`; `pnpm build` antes de `test:e2e`; `pnpm test:rls` y `test:e2e` comparten base: no correrlos a la vez; un *worker* de Vitest o de Playwright murió a veces con `0xC0000409` (pasa al repetir).

## Próxima acción probable
1. Pedir a Codex una ronda corta (solo lectura) que confirme el P2 del llamado (lock por cliente) y el P2 de «Mesas y QR».
2. Integrar la rama a `main` y decidir cuándo subir `main` a GitHub (va 3 commits adelantado).
3. Siguiente ítem: «Panel de sala en tiempo real» (desbloqueado) o el historial de precios (S).

## Estado del worktree al cerrar
- Rama `feat/llamado-desde-la-mesa` con el trabajo confirmado; `git status` limpio salvo lo ignorado a propósito (`impeccable`, `.env*.local`).
