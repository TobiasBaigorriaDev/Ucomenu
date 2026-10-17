# Cambio: Identidad del local en la carta

Estado: **Hecho**, con revisión comunicada por el usuario sin observaciones bloqueantes y ajustes menores atendidos. Rama `feat/identidad-local`, base `8b5b782`.
Nivel: **C por las nuevas políticas de Storage y permisos de columnas**; el alcance de producto del tablero era M.

## Objetivo y decisiones

El Dueño configura el logo y la paleta de su organización en Apariencia; se reflejan en todas sus cartas y QR, conservando la composición gastronómica actual.

- Identidad incluida en todos los planes según producto. Solo Dueño; cuenta editable, igual que el catálogo. Sin cambiar las reglas de negocio existentes.
- Paletas cerradas con contraste probado, elegidas explícitamente por el usuario: Oliva (actual, predeterminada), Azul, Vino y Cacao.
- Logo opcional JPEG/PNG/WebP, hasta 2 MB; ruta inmutable propia en bucket público separado `organization-logos`, como los recursos gráficos públicos del catálogo. Reemplazar/quitar intenta limpiar el archivo anterior después del guardado; falla cerrada la escritura y se registra cualquier error de limpieza.
- Columnas `organizations.menu_palette` y `logo_path`. Identidad consultada en vivo junto con organización/sucursal; las filas del menú conservan su caché y la suspensión sigue comprobándose en vivo.
- Panel Operate: configuración con vista previa de los colores; carta conserva tipografía y estructura. El nombre del local permanece visible junto al logo.

## Aceptación

- [x] Dueño elige, guarda y recupera una paleta; otra organización y el panel conservan su apariencia.
- [x] Sube, reemplaza y quita un logo; se ve completo, sin deformación ni desbordes en móvil y escritorio, tanto en `/m` como en `/t`.
- [x] Sin configuración se mantiene la carta actual; todos los pares de texto/fondo de las paletas cumplen contraste AA.
- [x] Formatos no admitidos, archivos vacíos/grandes y rutas ajenas se rechazan; errores de guardado no muestran éxito.
- [x] Staff, anónimo y miembros ajenos no modifican columnas ni archivos; solo lectura/suspendida bloquean cambios y conservan datos.
- [x] Migración, seed y tipos actualizados; pruebas focalizadas, RLS y E2E pertinentes, build, tipos y lint con evidencia del diff/commit.

## Invariantes, fallos y recuperación (C)

- La sesión y RLS deciden el local y rol; el formulario nunca es autoridad. Storage exige ruta propia, Dueño y cuenta editable. Sin `service_role` en el flujo de escritura.
- Una carta suspendida conserva su comportamiento; el logo es un recurso de marca público, como las fotos, y no contiene datos privados. La URL de imagen solo admite el bucket previsto del Supabase configurado.
- Ante fallo de subida no cambia la identidad; ante fallo de actualización se intenta retirar la subida nueva. Cero filas afectadas es error, aunque la API no devuelva error. Limpieza fallida queda registrada para recuperación; no se borra un archivo ajeno.
- Migración aditiva, aplicada solo a Supabase local. Revertir interfaz/lógica y deshabilitar nuevas escrituras permite recuperar sin borrar datos. Producción y staging requieren autorización separada.

## Evidencia y revisión

Implementación probada: `8b5b782..a781fc8`. Unidades de revisión: `db4ab29` (persistencia y módulo con regresiones de base) y `a781fc8` (interfaz y carta pública con E2E). Revertir ambas retira el flujo; las columnas y archivos pueden conservarse sin pérdida de datos.

- Docker y Supabase locales: `pnpm db:start`, `pnpm db:reset` y `pnpm db:types` **OK**. Migración `20261020100000` aplicada solo en local; seed de Café en Oliva y Parrilla en Cacao.
- `pnpm test src/lib/identidad/palettes.test.ts src/lib/public-menu.test.ts src/lib/menu.test.ts`: **21/21**. Contraste AA de las cuatro paletas, filas paginadas y armado de menú.
- `pnpm test:rls tests/rls/identidad.rls.test.ts tests/rls/acl.rls.test.ts tests/rls/tenancy.rls.test.ts tests/rls/images.rls.test.ts tests/rls/catalog.rls.test.ts`: **117/117**. Roles, aislamiento, mora, rutas, formatos, reemplazo/limpieza y compensación de subida fallida.
- `pnpm typecheck`, `pnpm lint` y `pnpm build`: **OK** (build fuera del sandbox; incluye `/panel/[org]/apariencia`).
- `pnpm exec playwright test e2e/identidad.spec.ts e2e/rendimiento-carta.spec.ts --workers=2`: **15/15**. Incluye carta y QR tras editar, persistencia, Staff, mora, tipo fingido, caché, suspensión y aislamiento.
- Primer E2E: 3/5; dos fallos de preparación corregidos (slug de prueba con `_` y selector ambiguo con el anunciador de rutas de Next). La ejecución final anterior incluye los cinco casos en verde.
- Inspección visual conjunta a **390 y 1280 px**, panel y carta; logo rectangular transparente, `object-fit: contain` y sin desborde. Capturas en `output/playwright/identidad/` (ignoradas). Se conserva el sistema visual existente; sin cambios de tokens globales.
- No se ejecutaron suites completas de RLS/E2E: se filtraron por los contratos afectados. Sin cambios en dependencias, staging ni producción; sin prueba en teléfono real.
- Revisión comunicada por el usuario sobre `a781fc8`: cinco observaciones menores, ninguna bloqueante. No se atribuye a un agente o sesión cuya identidad no fue indicada. No se invocó otro agente.

## Ajustes y límites tras la revisión

- Ajuste S sobre `a781fc8`: `PublicMenu.organization.menu_palette` es `Palette` obligatorio; la lectura de la base valida y normaliza a Oliva. Una nueva regresión comprueba que las nueve variables predeterminadas de `carta.css` coinciden con Oliva; las pruebas existentes ya cubren los textos blancos de las paletas.
- Comprobación del ajuste: `pnpm test src/lib/identidad/palettes.test.ts src/lib/public-menu.test.ts src/lib/menu.test.ts` **22/22**; `pnpm typecheck` y `pnpm lint` **OK**. Sin cambios de CSS, esquema ni permisos; no se repiten build/RLS/E2E de la entrega funcional anterior.
- **Límite aceptado: concurrencia.** Dos subidas que leen el mismo logo anterior pueden dejar una de las versiones nuevas huérfana. No hay reconciliación ni purga automática; requiere limpieza operativa si ocurre.
- **Límite aceptado: cantidad.** La API limita cada archivo a 2 MB, pero no la cantidad de objetos por organización. Un Dueño con cuenta editable puede subir muchos por API directa, igual que en `product-images`; no se agregan cuotas en este incremento.
- **Límite aceptado: existencia.** La base valida formato y carpeta propia de `logo_path`, pero no comprueba que el archivo exista. Por API directa, el Dueño puede dejar rota la imagen de su propia carta. El flujo de subida del panel guarda la ruta después de subir.
