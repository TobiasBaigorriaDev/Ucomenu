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
4. **La purga no corre sola:** el texto promete 14 días; hasta programar `purge_waiter_calls` (paso 4 de `docs/produccion.md`) la promesa no se cumple. No publicar a producción antes.
5. **Términos comerciales:** precios y condiciones se dicen «acordados al contratar». Si hay un contrato o una página de precios, enlazarla.

## Aceptación
- [x] Las tres páginas son públicas (200, sin sesión), con título, fecha de actualización y cabida en 390 px.
- [x] La portada, el login y la carta pública enlazan a los tres textos.
- [x] La carta pública no deja cookies ni datos locales (respalda lo que dice la política).

## Evidencia (2026-10-16, diff sin commitear; luego del commit queda en Git)
`pnpm typecheck` · `pnpm lint` · `pnpm test` 281/281 · `pnpm build` · `playwright e2e/legal.spec.ts` 8/8. No se revisó a ojo en un teléfono real ni con lector de pantalla.
