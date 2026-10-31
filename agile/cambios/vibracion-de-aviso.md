# Cambio: Vibración de los avisos con intensidad elegible
Estado: verificado en local (2026-10-31); sin push ni staging; falta probar en un Android real
Nivel: M (una columna más de `organizations` con permiso por columna solo del Dueño, como [tonos-de-aviso](tonos-de-aviso.md); no toca dinero, datos existentes ni borrados)

## Objetivo
En un salón ruidoso el sonido no alcanza: que el celular **vibre fuerte** cuando una mesa llama, pide la cuenta o un pedido queda listo, y que el Dueño elija la intensidad. Los mozos usan Android.

## Decisiones
- **Un nivel por local** (`organizations.vibration`: `ninguna`, `suave`, `fuerte`, `muy_fuerte`), por defecto **`fuerte`** (el pedido era «que vibre bastante»: los locales existentes pasan a vibrar fuerte). Se elige en la misma sección «Tonos y vibración de aviso» de `/panel/{slug}/llamados`, con «Probar» en cada nivel; el Staff lo ve en texto. Migración `20261214100000`.
- **Los patrones viven en código** (`src/lib/sala/vibracion.ts`), no en la base: la base guarda solo el nivel. Cada nivel tiene un patrón distinto para **llamar al mozo**, **pedir la cuenta** y **pedido listo**, para reconocerlos sin mirar (la cuenta es el más largo). `muy_fuerte` llega a 3,4 s (llamado) y 5,1 s (cuenta); tope de 6 s.
- **Con la pantalla abierta** (sala, panel, cocina): `navigator.vibrate` junto al tono, dentro de `beepIfOn`; solo con las alertas activadas (silenciar apaga también la vibración) y sin efecto en iPhone/escritorio. Si un lote trae una cuenta y un llamado, vibra el patrón de la cuenta. Plato nuevo en cocina usa el patrón del llamado.
- **Con la app en segundo plano o el celular bloqueado** (push): el servidor lee el nivel del local al armar el aviso y lo manda como `vibrate` en el payload cifrado; el service worker lo **valida como dato no confiable** (enteros de 1 a 3000 ms, hasta 15 tramos y 6 s en total; si no cumple, la notificación sale sin patrón). Si no se puede leer el nivel, se usa `fuerte` y el aviso sale igual.
- **iPhone/iPad** no exponen la vibración a la web: queda fuera, y la pantalla lo dice.

## Aceptación
- [x] Un local nuevo vibra «fuerte»; el Dueño elige y guarda cualquier nivel (persiste al recargar y no afecta a otro local).
- [x] «Probar» vibra con el patrón del llamado sin guardar ni activar alertas; sin soporte lo informa.
- [x] Con las alertas activadas la sala vibra con el patrón del nivel elegido: el llamado y la cuenta con patrones distintos; apagadas o con «ninguna», no vibra.
- [x] El aviso push lleva el patrón del nivel y del tipo de llamado; con «ninguna» no lleva patrón; un patrón inválido se descarta.
- [x] El Staff, otro local, un anónimo y la cuenta en solo lectura no pueden cambiarlo; valores fuera del catálogo se rechazan (app y base).

## Fuera de alcance
Controlar la fuerza física del motor (la web solo fija duración y pausas); vibración en iPhone; patrones propios por local; vibrar con la sala cerrada sin push suscripto (depende del aviso push); aplicar el cambio a pantallas abiertas sin recargar.

## Evidencia (2026-10-31, árbol sin commit al escribir esta ficha)
- `pnpm typecheck`, `eslint src e2e tests` y `pnpm build`: correctos. `pnpm test`: **1322/1322** (nuevas: `vibracion.test.ts`, casos de vibración en `sonido-llamados.test.ts`, `push.test.ts` y `sala-sw.test.ts`).
- `pnpm test:rls tonos`: **8/8** (migración con `supabase migration up`, sin `db:reset`). No se corrió la suite RLS completa.
- E2E (79/79): `tonos-de-aviso`, `llamado-config`, `panel-llamados-aviso`, `cocina`, `sala`, `sala-push` y `panel-push`. Con un doble de `navigator.vibrate` que registra los patrones.
- **No ejecutado:** la vibración real en un Android (las pruebas usan dobles); el efecto del push con el celular bloqueado (depende del canal de notificaciones de Chrome, que tiene que tener la vibración activada); la fuerza percibida de cada nivel.
- Recuperación: revertir el incremento; el rollback SQL está en la migración.
