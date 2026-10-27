# Cambio: Audios de avisos del mozo y cocina
Estado: verificado en local
Nivel: M

## Objetivo y decisiones
- Reemplazar el pitido por los MP3 aportados por el usuario: `notificacion.mp3` para llamados de mesa y platos nuevos en cocina; `notificacion-plato-listo.mp3` para el mozo cuando cocina termina un pedido.
- Pedido terminado para este aviso: hay platos recién marcados listos, al menos uno listo para entregar y ninguno anotado ni en cocina. Los entregados ya están completados; los cancelados no cuentan. Se conserva el aviso visual por cada plato listo.
- Un aviso por actualización, sin repetir al sondear, cargar la página o cambiar la vista de sucursales. Si coinciden llamado y pedido completo, tiene prioridad el audio de plato listo.
- Mantener activación por gesto, preferencia, silenciamiento y continuidad al navegar. Precargar y decodificar ambos MP3 con Web Audio; una nueva reproducción reemplaza la anterior y silenciar la detiene.
- Nivel M: comportamiento de presentación; no cambia estados de pedidos, permisos, consultas, esquema ni importes.

## Aceptación
- [x] Llamados del mozo y platos nuevos del chef reproducen `notificacion.mp3` con las alertas activadas.
- [x] Un pedido parcialmente listo solo avisa visualmente; completar el último pendiente reproduce `notificacion-plato-listo.mp3` al mozo.
- [x] No se repite el audio al sondear sin cambios, cargar o cambiar sucursal; deshacer y completar de nuevo sí es novedad (comparación existente por ids).
- [x] Silenciar detiene el audio actual e impide nuevos; se mantiene el desbloqueo por gesto y el manejo de errores.
- [x] Ambos archivos se sirven y decodifican correctamente en navegador.

## Fuera de alcance
Sonido personalizado de notificaciones push del sistema operativo (lo controla el navegador/SO), avisos nuevos fuera de Mesas, despliegue y producción.

## Evidencia y recuperación
- Alcance: incremento de `feat/audios-notificaciones` desde `e98a02a`. Preservar `tools/escenarios-locales.mjs` ajeno. Los dos MP3 pasan a ser parte del incremento por pedido explícito del usuario; se incorporan sin modificar sus bytes.
- `pnpm test src/lib/sala/beep.test.ts src/lib/sala/mesas.test.ts`: 25/25, incluyendo carga, buffer elegido, caché, reemplazo/detención de reproducción, fallo de red y reintento, pedido parcial/completo y ausencia de novedades.
- `pnpm test`: 1213/1214 en la corrida completa; timeout de 5 s en un caso de Git de `tests/unit/revision-claude.test.ts`, ajeno al cambio. Reintento único aislado del archivo: 17/17. No se cambió el test ni su timeout.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: correctos. Lint focalizado tras el último ajuste de copy y pruebas: correcto.
- `pnpm db:start` y `pnpm db:reset`: base local preparada. `pnpm exec playwright test e2e/cocina.spec.ts e2e/panel-llamados-aviso.spec.ts e2e/sala.spec.ts --grep 'sonido|suena|suenan|sonar|sonando|MP3|plato' --workers=1`: **10/10**, corrida completa correcta; incluye los MP3 reales servidos y decodificados por Chromium, parcial/completo, recarga, navegación, silencio y cambio de sucursal. Los dobles registran cuál de los dos audios se reproduce.
- No se ejecutó RLS: no cambia esquema, autorización ni consultas. No se modificaron entornos remotos; pendiente prueba manual de escucha en los dispositivos del usuario.
- Recuperación: revertir este incremento (motor de audio, selección de sonido y archivos); sin cambios de base.
