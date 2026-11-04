# Copias cifradas: generar y recuperar

El formato propio v1 usa AES-256-GCM de Node/OpenSSL y `tar` del sistema (ya disponible en Windows). `pnpm respaldo` produce un archivo `AAAA-MM-DDTHH-MM-SSZ.tar.gz.aes`; incluye esquema, datos, archivos y manifiesto. Comprueba los hashes, descifra y ejecuta la apertura completa antes de publicar. La publicación atómica usa enlaces duros: el destino debe admitirlos (NTFS en Windows; no FAT/exFAT). Una copia fallida no se informa como lista.

## Preparar la clave y el destino

1. Crear fuera del repositorio un archivo de entorno protegido. Para remoto incluir las variables de conexión indicadas en `docs/operacion.md` y `RESPALDO_ENCRYPTION_KEY`: **64 caracteres hexadecimales aleatorios**, no una contraseña humana. Generarla en el gestor de contraseñas o en una terminal privada con `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`. No pegarla en el chat, argumentos ni Git. No se generó ni almacenó una clave real del usuario en este cambio.
2. Guardar la clave en un gestor y una copia offline separada de los respaldos. Si se pierde, la copia no se puede recuperar. Al rotarla, conservar las anteriores hasta que caduquen sus copias; identificar cuál corresponde en el gestor por fecha.
3. Elegir un directorio fuera del repo, OneDrive y otras carpetas sincronizadas, en un volumen cifrado con BitLocker o equivalente y con acceso restringido. Se crean temporales en claro allí, tanto al exportar como al recuperar; se limpian al finalizar, pero un cierre forzado puede dejarlos. Antes de volver a usar la máquina, revisar directorios `.respaldo-*`, `.cifrado-*` y `.descifrado-*`. No eliminar una copia previa: los temporales llevan prefijo y no son archivos `.aes`.

## Generar

```powershell
pnpm respaldo --local --env C:\UcoMenuPrivado\local.env --destino D:\UcoMenuCopias
# Remoto: requiere autorización para el entorno correspondiente.
pnpm respaldo --remoto --env C:\UcoMenuPrivado\produccion.env --destino D:\UcoMenuCopias
```

No se programa automáticamente contra producción ni se toca una conexión real. Conservar la política 7 diarias, 4 semanales y 3 mensuales, con límite máximo de 3 meses. Copiar **solo el archivo cifrado** a una segunda ubicación independiente; jamás el archivo de claves ni los temporales. La segunda ubicación y su posible transferencia internacional requieren validación antes de usarla. Las copias viejas en claro no se migran ni borran automáticamente; cifrarlas en un procedimiento aparte y verificar recuperación antes de considerar su eliminación.

## Recuperar

```powershell
pnpm respaldo:abrir --archivo D:\UcoMenuCopias\2026-11-04T10-00-00Z.tar.gz.aes --destino D:\UcoMenuRecuperacion\ensayo --env C:\UcoMenuPrivado\clave.env
```

El padre del destino debe existir y estar protegido; `ensayo` debe ser una carpeta nueva fuera del repo. No se sobreescribe un destino existente. La autenticación GCM se valida antes de leer el tar. La extracción escribe únicamente las rutas relativas seguras del manifiesto y verifica hashes, SQL y buckets antes de publicar la carpeta. Clave errónea, archivo alterado o truncado: falla y limpia sus temporales, conservando la copia cifrada.

Después seguir el ensayo de restauración de `docs/operacion.md`: importar a una base aislada, recuperar Storage, probar acceso y fotos. Descifrar/verificar un archivo no demuestra por sí solo una restauración completa de PostgreSQL. Al terminar el ensayo, quitar la copia temporal en claro según el procedimiento de datos del responsable; no eliminar el `.aes` de origen.

## Estado

Implementación local; pruebas y revisión en [la ficha](../agile/cambios/retencion-cifrado-transferencias.md). Queda configurar la clave real, confirmar cifrado del volumen de trabajo, programar y ensayar la copia real del entorno aprobado. No se comprobó BitLocker ni se accedió a credenciales del usuario.
