# Cambio: Paginar categorías y platos de la carta pública

Estado: **Hecho**. Comprobación afectada y diff revisados; sin revisión independiente por ser nivel S (aclarado por el usuario).
Nivel: **S**. Rama: `fix/paginacion-carta-publica`; base: `27b4fb1`.

## Aceptación y decisiones

- [x] La lectura pública recupera todas las categorías y platos aunque superen las 1000 filas por tabla.
- [x] Cada página conserva el filtro de organización y pide un orden estable por `id`, mediante el helper existente `readAllPages`.
- [x] Un error en una página posterior rechaza la lectura completa y conserva el mensaje específico de la tabla.
- El orden visible sigue a cargo de `groupMenu`; se mantienen el cliente anónimo, las columnas seleccionadas y la caché existente. Sin esquema ni cambios de permisos.

## Evidencia

Implementación probada: `81be3ac`, cambios de `src/lib/public-menu.ts` y nueva regresión `src/lib/public-menu.test.ts` respecto de `27b4fb1`.

- Antes de corregir: `pnpm test src/lib/public-menu.test.ts` → 5 fallos y 1 caso correcto; detecta lecturas incompletas, falta de orden estable y errores de páginas posteriores que nunca se consultaban.
- Después: `pnpm test src/lib/public-menu.test.ts src/lib/paginar.test.ts src/lib/menu.test.ts` → **22/22**, en 3 archivos.
- Escenario de ejecución: cliente Supabase real con HTTP simulado, tope de 1000 filas; casos de 0, 1000, 1001 y 2005 categorías y platos, comparados fila por fila, y error de segunda página en cada tabla.
- `pnpm typecheck` y `pnpm lint` → **OK**.
- `pnpm build` → **OK fuera del sandbox**, incluidos TypeScript y generación de las 13 páginas estáticas. También completó `node node_modules/next/dist/bin/next build` fuera del sandbox, sobre el mismo código de `81be3ac`.
- Diagnóstico de los fallos previos: una prueba controlada con un servidor TCP local y el worker generado de Turbopack reproduce `connect EACCES 127.0.0.1` dentro del sandbox. El manejador de cierre del socket termina el worker con código 0 y oculta la causa en el mensaje del build. Fuera del sandbox conectan tanto un cliente TCP mínimo como el worker real. Los dos intentos previos habían fallado (uno escalado); esta ronda completó el build sin modificar CSS, configuración ni dependencias.
- RLS y E2E no ejecutados: corrección acotada del cargador, sin cambios de esquema, permisos ni interfaz; la regresión ejercita la frontera HTTP de Supabase sin base ni red.

Recuperación: revertir los cambios del cargador y retirar su nueva prueba; no requiere operaciones sobre datos.
