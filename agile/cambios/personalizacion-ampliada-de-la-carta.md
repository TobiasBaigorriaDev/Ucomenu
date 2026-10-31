# Cambio: Personalización ampliada de la carta
Estado: en curso (implementado y verificado en local; sin commit, sin staging, falta revisión independiente de la parte C y tu aprobación)
Nivel: **C** (la portada suma archivos públicos de la organización, una función con permisos y políticas heredadas de Storage, y la voz del local expone texto y números a anónimos). Tipografía, forma, densidad y ambientación son **M** y viajan en la misma entrega. [ADR 0050](../../docs/decisiones/0050-personalizacion-ampliada-de-la-carta.md). Antecedentes: [identidad del local](identidad-del-local.md), [personalización de la carta](personalizacion-carta.md), ADR 0036 y 0037.

## Objetivo
Cinco herramientas nuevas en `/panel/[org]/apariencia` para que cada local sienta la carta propia sin romper la legibilidad, el contraste AA ni la carga en el celular: tipografía, forma y densidad, ambientación, datos del local y portada con foto.

## Decisiones
- Todo cerrado y curado; ver el ADR para los motivos y las alternativas.
- Migraciones: `20261212100000_personalizacion_ampliada` (M), `20261212110000_voz_del_local` (C) y `20261212120000_portada_del_local` (C). Aditivas; cada una trae su rollback en el encabezado.
- Nombres de opciones elegidos para no chocar con los selectores de las pruebas E2E existentes («Tradicional» y no «Clásica»; «Follaje» y no «Hojas»).
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
- [ ] Revisión visual del usuario en teléfono real, sobre todo las fuentes anchas con nombres largos.

## Fuera de alcance
Colores o fuentes libres, cupo por plan, video de portada, horarios por sucursal, traducción del lema, «looks» de un clic que combinen todo (siguiente paso natural).

## Evidencia (árbol sin confirmar sobre `f2327af`)
- `pnpm lint`: sin errores (una advertencia ajena en `video/`). `pnpm build`: verde.
- `pnpm test`: 1277 de 1277 (nuevos: `apariencia.test.ts`, `voz.test.ts`; amplía `textos`).
- `pnpm test:rls identidad reemplazo`: 30 de 30 (nuevas: catálogos, voz con el espejo de los `check`, portada con reemplazo, distinta del logo, permisos). La corrida completa de `pnpm test:rls` se registra abajo.
- `pnpm exec playwright test e2e/identidad.spec.ts e2e/rendimiento-carta.spec.ts`: 16 de 16 antes de agregar la prueba nueva; la prueba nueva (tipografía → forma → ambientación → tema manda → datos → portada → quitar) pasa sola.
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
- Revisión independiente: pendiente (`pnpm revision:codex`, ver la skill `ciclo-revision-codex`).
- Aprobación del usuario para staging: pendiente.
