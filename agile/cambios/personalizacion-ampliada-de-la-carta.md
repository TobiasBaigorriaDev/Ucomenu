# Cambio: Personalización ampliada de la carta
Estado: para verificar (implementado y verificado en local en la rama `feat/personalizacion-ampliada`; sin staging; revisión independiente hecha, falta tu visto bueno y tu aprobación)
Nivel: **C** (la portada suma archivos públicos de la organización, una función con permisos y políticas heredadas de Storage, y la voz del local expone texto y números a anónimos). Tipografía, forma, densidad y ambientación son **M** y viajan en la misma entrega. [ADR 0050](../../docs/decisiones/0050-personalizacion-ampliada-de-la-carta.md). Antecedentes: [identidad del local](identidad-del-local.md), [personalización de la carta](personalizacion-carta.md), ADR 0036 y 0037.

## Objetivo
Cinco herramientas nuevas en `/panel/[org]/apariencia` para que cada local sienta la carta propia sin romper la legibilidad, el contraste AA ni la carga en el celular: tipografía, forma y densidad, ambientación, datos del local y portada con foto.

## Decisiones
- Todo cerrado y curado; ver el ADR para los motivos y las alternativas.
- Migraciones: `20261212100000_personalizacion_ampliada` (M), `20261212110000_voz_del_local` (C) y `20261212120000_portada_del_local` (C). Aditivas; cada una trae su rollback en el encabezado.
- Nombres de opciones elegidos para no chocar con los selectores de las pruebas E2E existentes («Tradicional» y no «Clásica»; «Follaje» y no «Hojas»).
- El estilo Hoja (página de PDF) **no muestra la portada** —a propósito— pero sí el lema en su barra superior, y el panel lo avisa al elegir una portada. Horarios, Instagram y WhatsApp salen en el pie en todos los estilos.
- `next/font` no admite `...spread` en sus llamadas: las opciones de cada fuente se repiten.
- «Editorial» usa Playfair Display porque DM Serif Display no tiene métricas de reemplazo en `next/font`.
- `tsconfig.json` excluye `output/` (carpeta ignorada con copias de despliegues viejos): su copia de `apariencia/actions.ts` rompía el `tsc` del build al ampliar los tipos de error.

## Aceptación
- [x] El Dueño elige tipografía, forma, densidad y ambientación con vista previa real, guarda, y la carta pública lo refleja; otros locales no cambian.
- [x] Sin tocar nada, la carta se ve igual que antes (valores predeterminados).
- [x] La fuente cambia solo en los títulos; el texto de lectura conserva su letra. «Afiche» conserva su condensada y sus esquinas.
- [x] La textura no se dibuja con un tema de fecha vigente; el contraste AA con la textura puesta se prueba en las 12 paletas.
- [x] Lema, horarios, Instagram y WhatsApp se guardan como texto plano e identificadores; la base rechaza lo inválido; los enlaces los arma el servidor.
- [x] La portada se sube, se reemplaza y se quita con vista previa antes de guardar; borra su archivo anterior; nunca coincide con el logo; no hay desborde horizontal a 390 px.
- [x] Staff, ajeno y anónimo no escriben nada de esto (RLS).
- [x] Con el estilo Hoja el lema se ve y la portada no; el panel avisa (hallazgo de la revisión de Codex, corregido).
- [ ] Revisión visual del usuario en teléfono real, sobre todo las fuentes anchas con nombres largos.

## Fuera de alcance
Colores o fuentes libres, cupo por plan, video de portada, horarios por sucursal, traducción del lema, «looks» de un clic que combinen todo (siguiente paso natural).

## Evidencia (rama `feat/personalizacion-ampliada` sobre `f2327af`, commits `64088f0`, `f812d8f` y `bda86a0`)
- `pnpm lint`: sin errores (una advertencia ajena en `video/`). `pnpm build`: verde.
- `pnpm test`: 1277 de 1277 (nuevos: `apariencia.test.ts`, `voz.test.ts`; amplía `textos`). `pnpm typecheck` sin errores.
- `pnpm test:rls identidad reemplazo`: 30 de 30 (nuevas: catálogos, voz con el espejo de los `check`, portada con reemplazo, distinta del logo, permisos). **`pnpm test:rls` completo: 1514 pasan, 12 fallan y el resto se omite (1533).** Los 2 fallos causados por este cambio (`acl.rls.test.ts`: faltaba registrar `replace_organization_cover`) se corrigieron en `f812d8f` (22 de 22). Los otros 10 fallos son ajenos y vienen de los datos de demo que otras sesiones cargaron en la base local (locales Aurelia, Bruma Bistró, Fuego Andino, La Bestia y Patio Oliva, y platos extra de Café Ejemplo): `catalog.rls` (7), `tenancy.rls` (2) y `push.rls` (1: «un local sin membresías»). **No se comprobó sobre una base limpia** (`pnpm db:reset` borraría esa carga local); conviene hacerlo antes de integrar.
- E2E: `identidad.spec.ts` 7 de 7 (incluye la prueba nueva: tipografía → forma → ambientación → tema manda → datos → portada → Hoja → quitar) y `rendimiento-carta.spec.ts` en verde. `menu.spec.ts` (3 pruebas) falla por los platos y categorías extra de Café Ejemplo en la base local (esperaba la carta del seed); `carta.spec.ts` «en gracia se edita» falló una vez y pasó al repetir (se anota, no se investigó).
- **Mutación de la defensa de concurrencia:** quitando `FOR UPDATE` de `replace_organization_cover` en la base local, la prueba determinista nueva («el reemplazo ESPERA el bloqueo…») falla 3 de 3 y la de reemplazos simultáneos también; con la función original, 21 de 21 en `reemplazo-de-imagenes`. La función quedó restaurada.
- Revisión visual con «Aurelia» local a 390 px: las 6 tipografías, forma recta y filete con densidad compacta, 5 texturas, lema y contacto; nombre de 47 caracteres con Bodegón, Nocturna y Moderna sin desborde.
- No corrido: staging, teléfono real, revisión independiente (ver abajo).

## (C) Invariantes
- Un valor fuera de los catálogos nunca llega a la carta (`check` en la base y descarte al leer).
- Ningún enlace de la carta sale de un texto escrito por el Dueño: solo `instagram.com/{usuario validado}` y `wa.me/{dígitos}`.
- `cover_path` y `logo_path` nunca son el mismo archivo; cada reemplazo borra solo la referencia que él desplazó.
- Solo el Dueño con cuenta editable escribe estas columnas y sube o borra archivos; `anon` y Staff no.
- Sin texto sobre la foto: el contraste del nombre no depende de ella.

## (C) Fallos y recuperación
- Falla la subida o la función de reemplazo: se borra el archivo recién subido y la portada vigente no cambia (misma mecánica que el logo, incluido el caso incierto, que no borra por las dudas).
- Rollback de cada migración en su encabezado; los archivos huérfanos de portada se limpian aparte (listar el bucket y comparar con `logo_path` y `cover_path`).
- El código nuevo con una base sin migrar falla al leer columnas inexistentes: aplicar las tres migraciones antes de desplegar.

## (C) Revisión y aprobación
- **Revisión independiente (Codex, solo lectura, `--base main`):**
  - Ronda 1 (informe `output/revisiones/2026-10-31T01-53-33-base-main.md`): aprobar con cambios, 2 hallazgos importantes, ambos reales. (1) El estilo Hoja no dibujaba lema ni portada: la portada se excluye a propósito y ahora está documentada y avisada en el panel; el lema se agregó a la barra de Hoja (`bda86a0`, con E2E). (2) La concurrencia de `replace_organization_cover` no tenía prueba propia: se agregaron reemplazos simultáneos, quitar mientras se reemplaza y fallo de limpieza (`bda86a0`).
  - Ronda 2 (verificación, informe `2026-10-31T02-03-24-base-main.md`): aprobar con cambios; (1) corregido; (2) parcial: las pruebas no forzaban de forma determinista la lectura sin bloqueo. Se agregó una prueba determinista que retiene la fila desde otra transacción y exige que el reemplazo espere y devuelva la referencia confirmada; validada con la mutación de arriba.
  - Codex no pudo ejecutar pruebas ni `git status` (el sandbox no ve el árbol de trabajo): su lectura fue estática.
- Aprobación del usuario para aplicar las migraciones y desplegar en staging: **pendiente**. El veredicto de Codex no la reemplaza.
