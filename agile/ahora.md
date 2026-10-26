# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Claude Code. Historia en Git y fichas.

## Punto de retomada

**Staging está en Fly v61** (imagen `ucomenu-staging:alimentaria-124bbc9`; marcha atrás: `apariencia-6b82cf2`, v60). Sin migraciones. Las tres páginas legales responden 200 y muestran los textos nuevos y los pendientes.

**Auditoría legal (nivel M, sin migración):** [ficha](cambios/informacion-alimentaria-y-textos-legales.md). La app no guarda ingredientes ni alérgenos, solo tres etiquetas declaradas por el local; se corrigieron los textos que sugerían lo contrario, se agregaron notas de contacto cruzado y de opciones en el detalle, y el aviso del filtro vacío. Hallazgo importante: cambiar el texto original de un plato, variante o adicional dejaba publicada la traducción vieja; ahora se quita (`src/lib/carta/traducciones-obsoletas.ts`, con prueba que falla sin el arreglo). `/terminos`, `/privacidad` y `/alergenos` se reescribieron; lo que el usuario no decidió aparece en las páginas como «Pendiente de definir antes del lanzamiento».

Commit `124bbc9` subido a `origin/main`.

## Límites y bloqueos

- **Producción sigue bloqueada** y ahora además por: abogado argentino, razón social/CUIT/domicilio (`LEGAL_ENTITY` en `src/lib/legal.ts`), correo de contacto, plazos comerciales, proveedor de IA y purgas sin programar. La ficha lista cada pendiente.
- Decisiones abiertas del usuario: etiquetas por sucursal (hoy de la organización), tratamiento de alergias anotadas en observaciones de pedidos, limpieza exacta de `rate_key` (hoy oportunista).
- S4 (Clientes recurrentes) sigue para el próximo incremento y conserva el requisito legal.
- Si Windows repite `0xC0000409` con `forks`, repetir con `--pool=threads`. Si `pnpm build` falla con `EPERM` en `.next`, borrar `.next`. Docker Desktop hay que encenderlo para RLS y E2E.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.
- Un E2E (`carta.spec` «en gracia se edita con normalidad») falló una vez con 2 workers y pasó solo; ajeno al cambio.

## Próximo paso

Que el usuario revise la ficha, decida los pendientes y consiga la revisión del abogado. Después, retomar el backlog del [tablero](tablero.md). Siguiente migración libre: `20261208100000`.
