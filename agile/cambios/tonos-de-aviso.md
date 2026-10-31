# Cambio: Tonos de aviso elegibles por el Dueño
Estado: en `origin/main` (`e028e64`) y desplegado en staging (Fly v83); falta tu escucha manual de los tonos
Nivel: M (escribe dos columnas nuevas de `organizations` con permiso por columna solo del Dueño, como [configuración del llamado](configuracion-del-llamado.md); no toca dinero, datos existentes ni borrados)

## Objetivo
Que el Dueño elija qué tono suena cuando **una mesa llama** y cuando **un pedido queda listo**, en vez de los dos MP3 fijos ([audios-notificaciones](audios-notificaciones.md)).

## Decisiones
- **Por local, no por sucursal ni por dispositivo:** dos columnas en `organizations` (`call_tone`, `ready_tone`) con el id de un tono. Rige en panel, sala y cocina de todos los dispositivos; el Staff y el cocinero lo oyen pero no lo cambian. Se aplica al recargar la pantalla (el layout de cada área lo fija).
- **Catálogo cerrado** en `src/lib/sala/tonos.ts`: los dos MP3 de siempre (`llamado`, `plato-listo`, valores por defecto, así que nada cambia hasta que se elija) más cinco tonos **sintetizados con Web Audio** (`campana`, `timbre`, `marimba`, `digital`, `alerta`): sin archivos, sin dependencias. Cualquier tono sirve para cualquiera de los dos avisos. El `CHECK` de la base repite los ids (una prueba unitaria compara ambos listados): no se puede guardar una URL ni un archivo.
- **Plato nuevo en cocina** suena con el tono de «llamado» (antes ya compartía el MP3 del llamado); no tiene ajuste propio.
- **Pantalla:** sección «Tonos de aviso» al inicio de `/panel/{slug}/llamados`, con «Escuchar» en cada opción (no activa las alertas ni guarda). El Staff ve los elegidos en texto.
- Permiso: `grant update (call_tone, ready_tone)` a `authenticated` + la política vigente de UPDATE de `organizations` (Dueño y cuenta al día). Migración `20261213100000_tonos_de_aviso.sql`.

## Aceptación
- [x] Un local nuevo sigue sonando con los MP3 de siempre.
- [x] El Dueño escucha cada tono, elige uno por aviso y guarda; la elección persiste al recargar y no afecta a otro local.
- [x] La sala suena con el tono elegido ante un llamado (la confirmación al activar también), no con el MP3; el de pedido listo no suena ante un llamado.
- [x] El Staff ve la elección sin poder cambiarla; Staff, otro local, anónimo y cuenta en solo lectura no escriben (aunque se fuerce la API); valores fuera del catálogo se rechazan (app y base).
- [x] A 390 px sin desborde.

## Fuera de alcance
Subir un tono propio; tono por sucursal o por persona; volumen; aplicar el cambio a las pantallas abiertas sin recargar; el sonido de las notificaciones push del sistema (lo controla el SO).

## Evidencia (2026-10-31, árbol sin commit)
- `pnpm typecheck`, `eslint src e2e tests` y `pnpm build`: correctos. `pnpm test`: **1296/1296** (nuevas: `tonos.test.ts`, `sonido-llamados.test.ts` y tres casos en `beep.test.ts`, incluida la nota más larga que cierra el tono).
- `pnpm test:rls tonos`: **7/7** (migración aplicada con `supabase migration up`, sin `db:reset`). No se corrió la suite RLS completa.
- E2E: `tonos-de-aviso.spec.ts` 3/3; `llamado-config.spec.ts` 18/18 (7 pruebas viejas buscaban «Guardar» por nombre parcial y chocaban con «Guardar tonos»: ahora `exact`); sonidos de cocina, panel y sala (`--grep` de audio) 10/10.
- **No ejecutado:** escucha real de los cinco tonos sintetizados (las pruebas usan un doble de Web Audio) ni en teléfono; el volumen relativo entre tonos y el MP3 es a oído.
- **Staging (2026-10-31, aprobado por el usuario):** migración aplicada con `supabase db push` en `ucomenu-staging` (el `--dry-run` previo mostró solo `20261213100000`). App: Fly **v83** `complete`, máquina `78177dda131e38` sana, imagen `registry.fly.io/ucomenu-staging:tonos-04143e4-git` (copia limpia de `04143e4`). `/`, `/login` y `/m/aurelia/centro` 200, local inexistente 404, `/panel/aurelia/llamados` sin sesión 307. **No probado:** la pantalla con una sesión real en staging. Marcha atrás de la app: `flyctl deploy -c fly.staging.toml --image registry.fly.io/ucomenu-staging:personaliza-bb3695b-git` (v82; la migración puede quedar, es aditiva).
- Recuperación: revertir el incremento; en una base con datos, el rollback SQL está en la migración (se pierde solo la elección).
