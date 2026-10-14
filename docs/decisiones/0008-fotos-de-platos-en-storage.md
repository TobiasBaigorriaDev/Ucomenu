# 0008 — Fotos de los platos: bucket público de Storage, ruta por organización y escritura con la cuenta al día

- Estado: aceptada
- Fecha: 2026-10-14

## Contexto
La gestión de carta necesita fotos por plato. La carta pública es pública y debe cargar rápido; las escrituras de catálogo ya dependen de la membresía y de que la cuenta pueda escribir (ADR 0005 y 0006). Storage es una superficie nueva: una política mal escrita permitiría subir a la carpeta de otro local o llenar el almacenamiento.

## Decisión
1. **Bucket público `product-images`** (la foto de la carta pública no es secreta; la URL lleva un uuid que no se adivina), creado **en una migración** junto con sus políticas, para que exista igual en cualquier entorno. Tipos JPEG/PNG/WebP y **2 MB** por archivo, exigidos por el propio bucket.
2. **Ruta `{organization_id}/{product_id}/{uuid}.{jpg|png|webp}`**, exigida con su forma exacta por la base. `products.image_path` guarda solo la ruta y un `check` obliga a que apunte a la carpeta **de ese plato**; la URL pública la arma el servidor.
3. **Políticas sobre `storage.objects`** para el rol `authenticated`: subir y borrar exigen ser miembro de la organización dueña de la ruta **y** `org_can_write` (en solo lectura y suspendida no se sube ni se borra, igual que el resto del catálogo); leer, ser miembro. **Sin política de `UPDATE`**: una foto nunca se pisa, cada subida lleva un uuid nuevo. Un anónimo no escribe nada.
4. **La app escribe con el cliente de la persona (RLS)**, nunca con `service_role`. El servidor valida el tipo **por los bytes** (no por el `Content-Type`) y el tamaño; el navegador reduce la foto antes de subirla (Canvas, sin dependencias) y la ampliación del límite de cuerpo de las *server actions* a 3 MB es solo el margen para eso.
5. **Orden al reemplazar o quitar:** subir con nombre nuevo → apuntar el plato → borrar el archivo anterior; si apuntar el plato falla, se borra el recién subido.

## Alternativas consideradas
- **Bucket privado con URL firmadas** — cada carta pública tendría que firmar URL por plato (más trabajo por pedido y sin caché útil) para proteger algo que ya es público.
- **Guardar la URL completa en `products`** — un campo libre que se podría apuntar a un archivo ajeno o a un sitio externo; la ruta acotada por `check` evita ambas cosas.
- **Subir desde el navegador directo a Storage** — obligaría a tener un cliente de Supabase en el navegador (ADR 0007 lo evita) y a repetir en el cliente las validaciones.
- **Reducir en el servidor** (`sharp`) — dependencia nueva y mover varios MB por la *server action*; el navegador ya tiene el decodificador y el Canvas.

## Consecuencias
- **Sin cuota de almacenamiento por organización:** el tope es el archivo (2 MB). Una cuota por plan queda como riesgo registrado.
- **Archivos huérfanos acotados** a fallas a mitad de camino (se registra la ruta en el log); borrar una organización no borra sus archivos (la cascada es de la base, no de Storage) y el borrado de platos/categorías llegará con su propio ítem, que deberá limpiar fotos.
- **Las fotos de una organización suspendida siguen accesibles por su URL**: el plato desaparece de la carta, pero el archivo es público.
- La optimización de imágenes (tamaños, caché, formato) es del ítem «Rendimiento de la carta pública»; hoy se sirven sin optimizar.
- El entorno local necesita `storage-api` (se quitó de la lista de exclusiones de `pnpm db:start`; tras actualizar, `pnpm db:stop` y `pnpm db:start`).
- **Producción:** al desplegar, la migración crea el bucket; hay que verificar en Supabase Cloud que `product-images` quedó público y con sus límites.
