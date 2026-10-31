# Cambio: Cierre de la revisión de preparación para producción
Estado: commits locales (sin subir a `origin`) y **desplegado en staging (Fly v89, 2026-10-31)** junto con los precios en pesos; **las tres tareas de `pg_cron` de staging siguen sin programar**
Nivel: **M** (textos legales, cabeceras, avisos del verificador y documentación; el cambio de dinero va aparte, en [precios en pesos](precios-en-pesos.md), nivel C)

## Objetivo
Cerrar los hallazgos de la revisión de preparación para producción (2026-10-31) que se podían resolver sin datos que solo tiene el usuario ni acciones remotas.

## Decisiones (las del usuario, 2026-10-31)
- **IA (I2):** el proveedor es **Gemini por ahora**; si va bien, Claude más adelante (hoy no existe ese proveedor). En producción la clave tiene que ser de **un proyecto de Google con facturación**, no la gratuita; `prod:check` lo recuerda siempre que hay clave. La política nombra a Google (Gemini) y dice que, si cambia el proveedor, se actualiza la lista.
- **Plazos y condiciones (B2):** reportes de salud en 24 h y los demás en 3 días hábiles; aviso de cambios sustanciales con 15 días; baja por correo, rige al vencer el período pagado y sin reembolso; cuentas del personal sin local: se borran a mano, a pedido o en una revisión al menos anual.
- **Copias de seguridad (I8), recomendación mía:** semanal antes del primer cliente y antes de cada migración; **diaria a las 07:00 de Argentina** desde el primer cliente real; 7 diarias + 4 semanales + 3 mensuales (la privacidad dice «hasta 3 meses»); una segunda copia cifrada fuera de la máquina y **nunca dentro de OneDrive**; Supabase Pro al primer cliente que paga. Detalle en `docs/operacion.md`, sección 2.
- **Cabeceras (I3):** HSTS de un año sin `includeSubDomains`, `nosniff`, `X-Frame-Options: SAMEORIGIN` con `frame-ancestors 'self'`, `Referrer-Policy`, `Permissions-Policy` sin cámara, micrófono, geolocalización ni pagos, y sin `x-powered-by`. **Sin CSP de scripts** a propósito (Next inyecta scripts en línea y pide nonces; se evalúa aparte). `robots.txt` por código: solo `ucomenu.com` con https se deja indexar y sin `/panel/`, `/sala/`, `/cocina/`, `/admin/`, `/t/`; staging y local piden no indexar nada.
- **Pendiente a propósito (7 marcadores visibles):** razón social, CUIT y domicilio (`LEGAL_ENTITY`, solo tuyos), correo de contacto (`NEXT_PUBLIC_CONTACT_EMAIL`), plazos de pedidos (2 años) y pagos (10 años) a confirmar con un contador, plazo del registro de auditoría, cifrado de las copias y marco de transferencias internacionales (abogado). **Esto no es asesoramiento legal ni queda aprobado: un abogado tiene que revisar los tres textos.**

## Qué cambió
- **Legal:** `/privacidad` suma la sección «5. Si hacés una reserva en un local» (qué datos, quién los ve, 30 días; el cocinero no accede) y la fila de retención; nombra a Google (Gemini); fija las copias en 3 meses; describe las cuentas sin local y los registros de los proveedores sin plazo inventado. `/terminos` dice la gracia (7 días), el solo lectura (días 8 a 15), la suspensión (desde el 16), la baja, los plazos de los reportes y el aviso previo, y que los precios están en pesos. Constantes nuevas `RESERVATION_RETENTION_DAYS` y `BACKUP_RETENTION_MONTHS` en `src/lib/legal.ts`; fecha de actualización 31 de octubre de 2026. Quedan 5 marcadores en privacidad (más responsable y contacto).
- **Seguridad:** `next.config.ts` (`securityHeaders`, `poweredByHeader: false`), `src/app/robots.ts` y `src/lib/seo/robots.ts`.
- **Verificador (`pnpm prod:check`):** Mux (aviso sin las tres variables, **error** con Mux a medias o con un secreto de Mux en una variable pública), Gemini (aviso siempre) y demo de la portada (aviso si no está definida o apunta a `.fly.dev`).
- **Documentación:** `docs/produccion.md` suma las variables de Mux, la decisión de Gemini, el paso 4.e (tarea `reset-scheduled-table-turns` que crea la migración y limpieza del historial de `pg_cron`: `prune-cron-history`, 7 días), el monitoreo mínimo de disponibilidad y las comprobaciones nuevas del paso 8; `docs/operacion.md` fija la frecuencia de respaldos.
- **Portada:** el contraste AA de los tokens queda medido y fijado por una prueba (`contraste.test.ts`): todos los pares de texto dan **5,2 a 15,3 a 1** (mínimo 4,5); el verde vivo (3,1) solo se usa en rombos decorativos. No mide texto sobre fotos o video.
- **Lint:** `video/**` (proyecto de video, no del producto) sale de ESLint; el aviso de `video/captura/local.mjs` desaparece.

## Aceptación
- [x] `/privacidad` describe las reservas y su borrado a los 30 días, nombra a Google (Gemini) y fija las copias en 3 meses; `/terminos` dice la gracia, el solo lectura, la baja y los plazos.
- [x] Toda ruta lleva las cabeceras y ninguna anuncia el framework; el robots de local/staging prohíbe todo y el de producción permite la carta pero no los paneles.
- [x] `prod:check` avisa de lo que falta de Mux, Gemini y la demo, y da error con Mux a medias.
- [ ] Los 7 marcadores restantes los resuelve el usuario (datos propios, contador, abogado).

## Fuera de alcance
La demo estable (se retoma después de crear producción), el proveedor Claude, una CSP de scripts, el número de WhatsApp (confirmar que es el definitivo), programar el respaldo, monitoreo externo, y toda operación sobre staging o producción.

## Evidencia (2026-10-31, árbol sin commit)
- `pnpm test` **1386/1386** (nuevas: `seo/robots`, `seo/cabeceras`, `marketing/contraste`, `verificar-produccion`), `pnpm lint` limpio, `pnpm typecheck`, `pnpm build` correctos.
- E2E **45/45** (`legal` con 3 pruebas nuevas, `cabeceras-seguridad`, `portada`, `suscripcion-precio`) contra el build local.
- RLS 244/244 en los 9 archivos de la ficha de precios.
- **Bloqueado por el sistema, no ejecutado:** programar `purge-video-comments`, `purge-expired-orders` y `prune-cron-history` en **staging** (escritura remota). El SQL está listo en `docs/produccion.md` (4.b, 4.c y 4.e). Solo se hicieron lecturas de staging: tareas programadas (3), 0 comentarios y 0 pedidos vencidos, disparador de solo-agregado encendido, 9.289 filas de historial de cron.
- **No probado:** las cabeceras en staging (el build local las sirve; falta desplegar), el correo de contacto, el texto con un abogado.
- **Staging (Fly v89):** las cabeceras de seguridad, el `robots.txt` (staging pide no indexar nada) y los textos legales nuevos están en `ucomenu-staging.fly.dev` (comprobado con `curl`). Ver los detalles del despliegue en la [ficha de precios](precios-en-pesos.md#staging-2026-10-31-aprobado-por-el-usuario).
