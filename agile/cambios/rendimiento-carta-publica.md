# Cambio: Rendimiento de la carta pública — fotos reducidas, caché con invalidación y medición contra el objetivo de carga
Estado: **verificado** en la rama `feat/rendimiento-carta` (2026-10-16), sin integrar a `main`
Nivel: **M** (pedido así; aun así se trató con rigor de C en lo que toca la suspensión de cuentas y el aislamiento entre organizaciones: pruebas de regresión y mutaciones, ver «Evidencia»)

## Objetivo
La carta (`/m/{org}/{sucursal}` y `/t/{token}`) carga rápido con datos móviles, **sin** dejar de reflejar de inmediato lo que el local edita ni de respetar la cuenta suspendida, lo inactivo y el aislamiento entre organizaciones.

**Objetivo de carga** (`docs/producto.md`, «Rendimiento»): **LCP < 2,5 s en 4G.** No define el perfil de red; se fijó el móvil de Lighthouse (1,6 Mbps de bajada, 150 ms de latencia, CPU 4 veces más lenta), que es conservador. Se mide con `tools/medir-carta.mjs` (Chromium de Playwright, 390 px, caché del navegador vacío en cada corrida, mediana de 5) sobre `tools/sembrar-carta-medicion.mjs`: 6 categorías, 36 platos, **una foto de 1600 px y ~326 KB por plato** (lo que deja la reducción del panel; es el peor caso realista).

## Decisiones
1. **Se cachea solo lo que cambia cuando el local edita: categorías y platos.** `unstable_cache` (no hay `cacheComponents`, ver `docs/arquitectura.md`), clave `["carta-publica", orgId]`, etiqueta `carta:{orgId}`, tope de 60 s (`CARTA_CACHE_SECONDS`).
2. **Se consulta SIEMPRE en vivo lo que decide si se publica:** que la organización exista y esté activa, que la sucursal exista, que la cuenta no esté suspendida (la consulta de organización+sucursal pasa por RLS; la RPC `public_menu_status` distingue «suspendida» de «no existe»). La caché va después de esa puerta y su clave lleva el id que esa consulta resolvió. Así, suspender, reactivar o dar de baja un local se ve **al instante**, sin esperar al tope ni depender de una invalidación (hoy no existe acción del SuperAdmin para suspender: ocurre por fechas, que ninguna etiqueta ve). Costo: 1 consulta por pedido en vez de 3 (la de organización+sucursal; categorías y platos salen de la caché).
3. **Lo no encontrado no se cachea; lo vacío sí.** Los 404 (slug inventado) no llegan a la caché, así que no se puede llenar con claves arbitrarias. Un resultado vacío SÍ se guarda: `unstable_cache` renueva en segundo plano al vencer y, si la renovación falla (como pasaba al negarse a guardar lo vacío), conserva el valor anterior para siempre (hallazgo de la revisión de Codex, reproducido con una prueba de 62 s). Costo aceptado: si la cuenta se suspende justo mientras se lee, RLS devuelve filas vacías y la carta queda «sin platos» hasta 60 s después de regularizarla.
4. **Límite aceptado (revisión de Codex):** una lectura en vuelo mientras alguien edita puede guardar los datos anteriores *después* de la invalidación por etiqueta; esa carta vieja dura como máximo `CARTA_CACHE_SECONDS` (60 s). Cerrarlo del todo exige una versión de la carta en la base (columna que cambie al editar y entre en la clave): es esquema y toca las tablas de la carta, así que queda como alternativa si el límite molesta.
5. **Invalidación con `updateTag` en `refresh()` de `src/app/panel/[org]/carta/actions.ts`**, por donde pasan todas las acciones que escriben (categoría: crear, renombrar, subir/bajar, activar; plato: crear, editar, subir/bajar, activar; foto: subir, reemplazar, quitar). `updateTag` y no `revalidateTag(…, "max")`: este último serviría una vez la versión vieja, y el local acaba de editar. `/t/{token}` usa la misma lectura; la mesa, su estado y su QR se resuelven siempre en vivo (un QR regenerado deja de valer al instante).
6. **Fotos por `/_next/image`** (WebP, `next/image` sin `unoptimized`), solo del bucket: `remotePatterns` fija el host de `NEXT_PUBLIC_SUPABASE_URL` y la carpeta `/storage/v1/object/public/product-images/**`; cualquier otra URL da 400. `dangerouslyAllowLocalIP` solo si ese host es `127.0.0.1`/`localhost` (los E2E locales); en la nube queda en `false`. Anchos acotados (`imageSizes: [96, 192]`, `deviceSizes: [384, 640, 1080, 1280]`) y `minimumCacheTTL` de 30 días: la ruta de cada foto lleva un UUID nuevo en cada subida, así que nunca cambia. Solo WebP (no AVIF: codificarlo en una máquina de 1 CPU compartida es lento y la ganancia no justifica el riesgo).
6. **Marcado:** miniatura `width/height` 96 (el marco mide 80/96 px) → el navegador elige 96 o 192 px según su pantalla, sin saltos; mosaico con `fill` y `sizes` por forma de celda (`TILE_SIZES`); la primera foto del mosaico mantiene `loading="eager"` y suma `fetchPriority="high"`; las demás, `lazy`. Mismos textos y `data-testid`.
7. **Fuera:** las miniaturas del panel siguen `unoptimized` (no es la carta pública).

## Aceptación
- [x] Un cambio hecho en el panel (nombre, precio, categoría, plato nuevo, activar/desactivar, foto subida y quitada) se ve en la carta pública **en la carga siguiente**, aunque la carta ya estuviera en caché (**salvo la carrera del punto 4 de las decisiones**: una lectura que ya estaba en vuelo durante la edición puede dejar la carta anterior hasta 60 s); también en `/t/{token}`.
- [x] La carta sí se sirve de la caché (un cambio hecho directo en la base no se ve hasta vencer el tope): la prueba existe para que las demás no pasen en vacío.
- [x] Una carta en caché deja de publicarse **apenas** la cuenta se suspende (`/m` y `/t`, con `noindex`) y vuelve al regularizarla; da 404 apenas el local se desactiva.
- [x] Lo inactivo no se publica ni cuando se cacheó estando activo.
- [x] Dos locales con la misma sucursal «centro» no mezclan platos, tampoco tras editar uno.
- [x] Las fotos llegan en WebP reducidas desde el propio dominio; el optimizador rechaza otros dominios y otros bucket/rutas de Storage (400).
- [x] LCP < 2,5 s en el perfil 4G de la medición (1,9 s; antes 11,3 s).

## Medición (antes → después, misma carta sembrada, mismo equipo)
| | Antes | Después |
| --- | --- | --- |
| LCP, 4G (1,6 Mbps, 150 ms, CPU 4x) | **11.332 ms** | **1.920 ms** |
| LCP, sin límite | 528 ms | 272 ms |
| Peso al cargar | 5.448 KB (16 imágenes, 5.226 KB, JPEG) | 281 KB (19 imágenes, 58 KB, WebP) |
| Peso tras recorrer toda la carta | 11.977 KB (36 imágenes) | 330 KB (42 imágenes; las del mosaico son otra variante) |
| CLS | 0 | 0 |
| HTML | 145,7 KB (14,1 KB comprimido) | 174,3 KB (15,1 KB comprimido): el `srcset` de cada foto |
| TTFB local (30 pedidos, mediana) | 35 ms | 29 ms |
| `pnpm build` | ~22 s | ~19 s (igual dentro del ruido) |

Límites de la medición: es local y con Chromium, no un teléfono real. **Las fotos sembradas son sintéticas**: reducidas a 96/192 px pesan ~2 KB cada una; una foto real de comida pesará varias veces más (estimación: 6–15 KB), así que el «después» real será mayor, pero del mismo orden y muy por debajo del «antes». El TTFB local casi no se mueve porque la base está en la misma máquina; en producción cada consulta ahorrada es una ida y vuelta a Supabase (pasa de 3 consultas, dos en serie, a 1).

## Qué conservar al rediseñar
- **Tamaños de imagen:** la miniatura declara `width/height` 96 y su marco mide `size-20 sm:size-24` (80/96 px): si el marco cambia, cambiar `width` (o pasar a `sizes`) y `imageSizes` en `next.config.ts`. En el mosaico, `TILE_SIZES` (por forma de celda) tiene que seguir el ancho real de cada celda (grilla de 2 columnas, máx. 48 rem; la alta necesita ~1,4× por el `object-cover`). Los anchos que no estén en `imageSizes`/`deviceSizes` se redondean al más cercano permitido.
- **Carga:** una sola foto `eager` + `fetchPriority="high"` (la candidata a LCP, la primera del mosaico); el resto `lazy`. Si el rediseño cambia qué ocupa el primer pliegue, mover ese `eager`. Reservar el tamaño de todas las fotos (marco fijo o `fill` en contenedor con alto) para no saltar.
- **Qué se cachea y cómo se invalida:** solo categorías y platos (`readRows` en `src/lib/public-menu.ts`), etiqueta `carta:{orgId}`, `updateTag` desde `refresh()` en las acciones del panel, tope de 60 s. **Todo lo que decide si se publica sigue en vivo** y cualquier dato nuevo de la carta que viva en otra tabla (logo, colores, horarios… «Identidad del local» del tablero) debe o bien leerse en vivo, o bien entrar en la caché **con una invalidación en la acción que lo escribe** y una prueba en `e2e/rendimiento-carta.spec.ts`. Nunca cachear la página entera ni el resultado de `getPublicMenu`: se publicaría una cuenta suspendida.
- **No romper:** la clave de la caché lleva el id de la organización; los 404 no se cachean; el optimizador solo acepta el bucket `product-images`; `/t/{token}` no se cachea (emite el ticket de visita en cada carga) y resuelve la mesa en vivo.

## Fuera de alcance / pendiente
- Optimizar las miniaturas del panel; AVIF; un CDN delante.
- **Más de una instancia:** la caché y `updateTag` son de cada proceso (hoy Fly corre una máquina). Con varias, la invalidación llega solo a la que ejecutó la acción y las demás se ponen al día dentro del tope de 60 s. Si se escala, decidir entre aceptar ese margen o un caché compartido (`use cache: remote` / `cacheHandlers`).
- Al reiniciar, la caché de imágenes optimizadas y la de datos se vacían: el primer comensal de cada foto paga la reducción (~decenas de ms por foto).
- Pendiente de producto: ninguno.

## Evidencia
Sobre la rama `feat/rendimiento-carta` (commit en el pie del informe del agente), Supabase local propio:
- `pnpm test` **321/321** · `pnpm test:rls` **501/501** (no se tocó esquema ni permisos; se corrió por completitud) · `pnpm typecheck` OK · `pnpm lint` OK.
- `pnpm build` OK y `pnpm exec playwright test` **189/189** (180 existentes sin cambios + 9 nuevos de `e2e/rendimiento-carta.spec.ts`).
- **Mutaciones (3, cada defensa rota de a una y detectada):** quitar `updateTag` → fallan 5 de 9 (panel, foto, QR, aislamiento, inactivo); sacar `orgId` de la clave → falla el de aislamiento (y los que comparten tenant por colisión); cachear la carta entera, estado incluido → fallan los dos de suspensión/baja. Las 3 versiones rotas se descartaron.
- **Imagen de producción:** `docker build` del `Dockerfile` con la configuración final: el modo `standalone` trae `sharp` y su binario de Linux (`@img/sharp-linux-x64`), `sharp` redimensiona dentro del contenedor y `server.js` queda con `remotePatterns` del host de Supabase en `https` y `dangerouslyAllowLocalIP: false`. No se corrió el contenedor contra una Supabase real ni en Fly.
- No ejecutado: prueba en teléfono real; medición contra staging en Fly (requiere desplegar, no autorizado).

## Revisión y aprobación
- **Codex, solo lectura, nivel C** (2 rondas): ronda 1 *aprobar con cambios* (2 «Importantes»); ronda 2 de verificación *aprobar con cambios*. El hallazgo de la caché vacía conservada (`NotCacheable`) estaba **real** (reproducido: la renovación fallaba y la carta vieja seguía publicada) y se corrigió con prueba de regresión que falla sin la corrección (comprobado). El de la **lectura concurrente que restaura datos invalidados** es real pero se deja como **límite aceptado** (máximo 60 s; solo si una lectura ya iniciada cruza una edición): cerrarlo exige una versión de la carta en la base. Pendiente de decisión del usuario.
