# Cambio: textos legales (términos, privacidad, aviso de alérgenos)
Estado: implementado y verificado en local (2026-10-16), sin subir
Nivel: S (páginas estáticas y enlaces; sin datos, permisos ni dinero). Lleva ficha porque deja puntos abiertos para el usuario.

## Objetivo
Tener publicados `/terminos`, `/privacidad` y `/alergenos`, enlazados desde la portada, el login y el pie de la carta pública (que también sirve `/t/{token}`).

## Decisiones (mías)
- Texto en español rioplatense, ligero y sin pretender ser contrato. Las afirmaciones sobre datos salen del código y los ADR 0010 y 0014: el identificador de cliente es un HMAC de la IP (no se guarda la IP), se borra a los 14 días; la carta no usa cookies ni almacenamiento local (lo comprueba una prueba E2E); el panel usa cookie de sesión.
- Marca de derechos: Ley 25.326 y la Agencia de Acceso a la Información Pública como órgano de control.
- El plazo de 14 días del texto sale de una constante (`WAITER_CALL_RETENTION_DAYS`, `src/lib/legal.ts`); si se cambia el plazo de la purga hay que cambiarla y la fecha `LEGAL_UPDATED_AT`.
- El email de contacto sale de `NEXT_PUBLIC_CONTACT_EMAIL`. Sin definir, el texto no inventa una dirección y manda a contactar al equipo «por el medio por el que te dimos acceso». No se usó ningún email personal.

## Pendiente — requiere decisión o a alguien del equipo (no lo resuelvo yo)
1. **Revisión de un abogado/a** antes de producción: no soy una fuente legal y el texto es un borrador razonable, no asesoramiento.
2. **Responsable y contacto reales:** nombre o razón social de quien opera UcoMenu y el email de contacto (`NEXT_PUBLIC_CONTACT_EMAIL`). Si el servicio llegara a estar sujeto a inscripción de bases de datos ante la AAIP, tampoco lo resuelve este cambio.
3. **Proveedores:** el texto dice «proveedores de infraestructura» sin nombrarlos y avisa que pueden estar fuera de la Argentina; al elegir hosting en «Salida a producción», revisar si hace falta nombrarlos.
4. **La purga no corre sola:** el texto promete 14 días; hasta programar `purge_waiter_calls` (paso 4 de `docs/produccion.md`) la promesa no se cumple. No publicar a producción antes, y comprobar que corrió y que no quedan llamados de más de 14 días. Los respaldos propios excluyen `waiter_calls` para no extender el plazo (`docs/operacion.md`).
5. **Copias de seguridad:** el texto de privacidad no las menciona. Cuando existan respaldos (con correos y hashes de contraseña, conservados cifrados por un plazo), agregar una frase y su plazo, y revisarla con el profesional.
6. **Términos comerciales:** precios y condiciones se dicen «acordados al contratar». Si hay un contrato o una página de precios, enlazarla.

## Aceptación
- [x] Las tres páginas son públicas (200, sin sesión), con título, fecha de actualización y cabida en 390 px.
- [x] La portada, el login y la carta pública enlazan a los tres textos.
- [x] La carta pública no deja cookies ni datos locales (respalda lo que dice la política).

## Ampliación — comentarios del feed (2026-10-23)
Nivel S (solo texto). Antes de habilitar los [comentarios](comentarios-del-feed.md) en producción, `/privacidad` y `/terminos` dicen: que se puede comentar desde el QR de la mesa con un nombre opcional y que **no se deben escribir datos personales**; qué se guarda (texto, nombre, video, fecha, estado y, una hora, un valor derivado de la IP) y que **no se guarda la mesa ni nada en el dispositivo**; que el comentario **no se publica hasta que el local lo aprueba** y que, publicado, lo ve cualquiera que abra los videos de esa carta; que los **rechazados se borran a los 7 días y los que nadie revisa a los 30** (los plazos salen de `src/lib/videos/retencion.ts`, la misma constante de la pantalla de moderación); cómo pedir que se quite un comentario (sin identificador, por local, video y texto); que el dueño y el personal los ven y deciden; y, en los términos, las reglas para el comensal (responsable de lo que escribe, sin insultos ni datos personales, el local puede rechazar o retirar sin explicar) y para el local (responsable de lo que aprueba, revisarlos antes, retirar lo que corresponda), más que UcoMenu no responde por los comentarios y retira lo que corresponda si le avisan. Fecha de actualización: 23 de octubre de 2026. Prueba E2E nueva en `legal.spec` (plazos, aprobación previa, reglas); `pnpm test` 903/903, typecheck, lint y E2E `legal` + `comentarios-feed` 26/26. En staging desde el 2026-10-23 (`a6fefbf`; las dos páginas ya muestran los textos de comentarios). Sigue valiendo el punto 1 de «Pendiente»: **un abogado debe revisar estos textos antes de producción**, y el punto 4 se amplía: la promesa de 7 y 30 días no se cumple hasta programar `purge_video_comments` (`docs/produccion.md`, paso 4.b).

## Actualización 2026-10-26
Los tres textos se reescribieron tras una auditoría legal: ver [información alimentaria y textos legales](informacion-alimentaria-y-textos-legales.md), que reemplaza los puntos 2, 3, 5 y 6 de «Pendiente» (responsable, proveedores, copias de seguridad, términos comerciales) con los pendientes visibles en las propias páginas. Siguen vigentes el punto 1 (abogado) y el 4 (purgas).

## Evidencia (2026-10-16, diff sin commitear; luego del commit queda en Git)
`pnpm typecheck` · `pnpm lint` · `pnpm test` 281/281 · `pnpm build` · `playwright e2e/legal.spec.ts` 8/8. No se revisó a ojo en un teléfono real ni con lector de pantalla.
