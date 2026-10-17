# Cambio: Paginar categorías y platos de la carta pública

Estado: **Para verificar** por Claude Code en sesión limpia.
Nivel: **S**. Rama: `fix/paginacion-carta-publica`; base: `27b4fb1`.

## Aceptación y decisiones

- [x] La lectura pública recupera todas las categorías y platos aunque superen las 1000 filas por tabla.
- [x] Cada página conserva el filtro de organización y pide un orden estable por `id`, mediante el helper existente `readAllPages`.
- [x] Un error en una página posterior rechaza la lectura completa y conserva el mensaje específico de la tabla.
- El orden visible sigue a cargo de `groupMenu`; se mantienen el cliente anónimo, las columnas seleccionadas y la caché existente. Sin esquema ni cambios de permisos.

## Evidencia

Diff probado: cambios de `src/lib/public-menu.ts` y nueva regresión `src/lib/public-menu.test.ts` respecto de `27b4fb1`, incluidos junto a esta ficha en el commit de entrega.

- Antes de corregir: `pnpm test src/lib/public-menu.test.ts` → 5 fallos y 1 caso correcto; detecta lecturas incompletas, falta de orden estable y errores de páginas posteriores que nunca se consultaban.
- Después: `pnpm test src/lib/public-menu.test.ts src/lib/paginar.test.ts src/lib/menu.test.ts` → **22/22**, en 3 archivos.
- Escenario de ejecución: cliente Supabase real con HTTP simulado, tope de 1000 filas; casos de 0, 1000, 1001 y 2005 categorías y platos, comparados fila por fila, y error de segunda página en cada tabla.
- `pnpm typecheck` y `pnpm lint` → **OK**.
- `pnpm build` → **no completado**: Turbopack falla al crear el proceso de compilación CSS (salida de Node con código 0 antes de conectar). Se repitió una vez fuera del sandbox y falló igual. Sin cambios en CSS ni configuración de compilación en este diff; la causa del fallo de entorno sigue sin determinar.
- RLS y E2E no ejecutados: corrección acotada del cargador, sin cambios de esquema, permisos ni interfaz; la regresión ejercita la frontera HTTP de Supabase sin base ni red.

Recuperación: revertir los cambios del cargador y retirar su nueva prueba; no requiere operaciones sobre datos. La revisión manual pendiente se limita al commit de esta entrega.
