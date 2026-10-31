# Revisión UX previa al lanzamiento

2026-10-29 · Nivel M · diff local sobre `61ec890`, preservando los cambios previos.

## Alcance y aceptación

Revisar carta, llamados, cuenta y comentarios, con comprobaciones de acceso y navegación existentes. Corregir defectos de presentación y recuperación; sin cambiar autorización, importes, persistencia ni reglas de negocio.

- Un fallo de transporte al llamar conserva la carta, informa el problema y permite otro intento manual.
- La cuenta larga conserva Cerrar visible al desplazarse y devuelve el foco al disparador.
- Los campos y errores de comentarios son legibles con paletas claras y oscuras.
- La carga fallida de comentarios permite reintentar dentro de la hoja.
- El pie de carta permanece accesible incluso con la barra ampliada por cuenta y reseña, a 320 px.

## Hallazgos

- Importante: `call-bar.tsx` dejaba escapar el rechazo de la acción hacia el límite de error de toda la carta.
- Importante: `comments-sheet.tsx` combinaba fondo blanco con tinta casi blanca de las paletas oscuras.
- Importante: `account-sheet.tsx` desplazaba Cerrar junto con las líneas de una cuenta larga.
- Menor: el error de la primera carga de comentarios pedía reintentar, pero no ofrecía control para hacerlo.
- Importante: el margen fijo de la carta no acompañaba el crecimiento del dock. Reproducido a 320 px: 134,86 px del pie quedan debajo de la barra tras pedir cuenta con reseña habilitada. Se mide la altura con ResizeObserver; el feed vacío comparte esa reserva y el feed con videos conserva su medición existente.

## Verificación

Diff probado sobre `61ec890`, sin commit: `output/ux/diff-probado.patch`, SHA-256 `60adb4339a2be311319dd88671ae01739207b8be115a657d0a34538d4bd2e5e4`. Incluye únicamente los archivos de esta corrección; el árbol conserva el trabajo previo de portada, videos y seguridad.

- `pnpm test`: 79 archivos / 1.221 pruebas correctas, antes y después de los cambios.
- `pnpm test src/lib/identidad/palettes.test.ts src/lib/idiomas`: 79 pruebas correctas.
- `pnpm lint`: correcto; ESLint focalizado tras el último cambio funcional: correcto.
- `pnpm typecheck` y `pnpm build`: correctos sobre la versión final.
- Cuatro E2E nuevos inicialmente correctos. La quinta prueba reprodujo el dock tapando 134,86 px del pie; después de corregirlo pasó junto con las demás.
- Comprobación final: **155 E2E correctos**, Chromium, 4 workers, contra `next start` del build final. Archivos: `portada`, `menu`, `buscador`, `detalle-plato`, `idiomas`, `acceso`, `sala-mesas`, `sala-operar`, `cocina`, `llamados`, `cuenta-del-comensal`, `comentarios-feed`, `feed-videos` (`e2e/*.spec.ts`). Incluye las cinco regresiones nuevas, flujos del dueño/personal, estados de cuenta, navegación y errores.
- Capturas inspeccionadas: `output/ux/barra-antes.png`, `barra-despues.png` (320 px), `cuenta-larga.png` y `comentarios-carbon.png` (390 px). Los campos usan los pares de colores AA ya comprobados de cada paleta; la regresión verifica su aplicación real en las cuatro oscuras.

Supabase local ya estaba activo y `db:start` confirmó su disponibilidad. No se ejecutó `db:reset`, para preservar los locales de demostración existentes; las pruebas crean y limpian sus propios locales ficticios. No se alteró esquema ni se ejecutaron migraciones, RLS completo, servicios remotos o despliegues. El navegador integrado estaba indisponible; se usó el Playwright instalado en el proyecto.

## Límites y pendientes de lanzamiento

No equivale a una certificación completa de accesibilidad ni a una prueba en teléfonos físicos/Safari. No se corrió toda la suite E2E ni RLS: no hay cambios en permisos, SQL ni reglas de cobro. La auditoría de seguridad previa conserva su propia [evidencia](auditoria-seguridad-2026-10-28.md).

Persisten los bloqueos previos, que requieren datos o decisiones del usuario: `LEGAL_ENTITY` sigue en `null`; la [portada](portada-ucomenu.md) anuncia precios ARS mientras el catálogo de facturación sigue en USD, y el anual Pro está por confirmar; el enlace/QR de demostración debe apuntar a un local publicado. La preparación operativa está en [producción](../../docs/produccion.md). No se inventaron datos legales ni se cambiaron reglas comerciales.

Reversión: revertir solo el diff de esta ficha; no hay cambios persistentes de aplicación que recuperar. Sin commit, push ni despliegue de esta sesión.

## Integración y despliegue (2026-10-29)

El usuario autorizó push y despliegue. Commit `ce4a710` subido a `origin/main` con solo la unidad de UX. Se preparó un worktree aislado en `%TEMP%/ucomenu-ux-ce4a710` para desplegar sin incorporar portada ni feed pendientes. `flyctl status -a ucomenu-staging` mediante la imagen oficial en Docker falló: la sesión de Fly carece de un token de autorización válido. No se inició despliegue ni se tocaron migraciones o secretos. Requiere renovar la sesión de Fly y repetir desde ese commit.
