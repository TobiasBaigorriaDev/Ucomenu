# Cambio: información alimentaria segura y textos legales coherentes con la app

Estado: **implementado y verificado en local (2026-10-26)**, sin subir ni desplegar. Los textos legales siguen necesitando a un abogado argentino y decisiones del usuario (ver «Pendiente»).
Nivel: **M** (texto, avisos y una escritura ordinaria y recuperable; sin autorización, dinero ni borrado irreversible). Sin migración.

## Origen y hallazgos
Auditoría legal previa al lanzamiento. Se investigó el código antes de cambiar nada. **La app no guarda ingredientes ni alérgenos:** solo tres etiquetas declaradas por el local en el plato (`dietary_tags`: Sin TACC, Vegano, Vegetariano; vacío = sin declaración, [ADR 0016](../../docs/decisiones/0016-etiquetas-y-disponibilidad-de-carta.md)). Eso resuelve de raíz «ausente = seguro»: nada se deduce de lo no declarado y el filtro solo muestra lo etiquetado.

| Riesgo | Estado hallado | Gravedad | Acción |
| --- | --- | --- | --- |
| Pie y detalle decían «la información de alérgenos de cada plato la declara el local» | Falso: la carta no muestra alérgenos; sugería datos que no hay | Alta | Textos nuevos: la carta no informa alérgenos, sin etiqueta ≠ apto, consultar al personal antes de pedir (es/en/pt) |
| Traducción vieja tras editar el texto original | Editar nombre/descripción de un plato, o el nombre de una variante/adicional, dejaba la traducción anterior publicada (ej.: se agrega «con maní» en español y el inglés no) | **Alta** | Al guardar, se quita la traducción de ese campo en todos los idiomas (`traducciones-obsoletas.ts`) y el panel lo avisa. Prueba de regresión que falla sin el arreglo |
| Variantes/adicionales pueden romper una etiqueta | La etiqueta es del plato; una opción («extra queso») no la cambia | Media | Nota en el detalle (solo con etiqueta y opciones) y aviso en el panel de opciones |
| Contacto cruzado | Solo en `/alergenos` | Media | Nota en el detalle de todo plato etiquetado |
| Filtro vacío | «Probá con otro nombre» sugería que no hay opciones | Media | Aviso: no aparecer no significa que el local no tenga opciones; consultar |
| Etiqueta única para todas las sucursales | El ajuste por sucursal es solo precio/agotado/oculto | Media | **No se cambió el modelo.** Ayuda del panel y términos: si no se cumple en una sucursal, ocultar el plato allí. Decisión abierta |
| Caché | `updateTag` al guardar + tope de 60 s ([`public-menu.ts`](../../src/lib/public-menu.ts)) | — | Ya resuelto; sin cambios |
| `/alergenos`, términos, privacidad | Ver abajo | Alta | Reescritos |

## Qué cambió en los textos legales
- **Términos:** se eliminó la exención de la información de alérgenos y la limitación a daños directos frente a consumidores (Ley 24.240, art. 37); el local responde por lo que carga y UcoMenu por sus propias obligaciones y fallas técnicas. Se quitó «vale lo que te informe el personal» (precio). Nueva obligación de mantener al día ingredientes, precios y etiquetas, marcar solo lo confirmable (incluido el contacto cruzado) y retirar de inmediato lo incorrecto. Nueva sección 7 de reporte de información incorrecta o riesgosa (sin plazos inventados). Suspensión por incumplimiento o riesgo, baja y cambios con aviso; los plazos están como **pendientes**.
- **Privacidad:** responsable y contacto (pendientes visibles), IP e identificadores derivados tratados como dato personal (la clave permite comprobar una IP), la limpieza «a la hora» es oportunista (se dice), conservación por tipo de dato con los plazos reales del código y los ADR, proveedores (Supabase, Fly.io, Mux, push del navegador, Cloudflare DNS, IA), transferencia internacional (São Paulo) con el marco legal **pendiente**, y procedimiento de derechos con los plazos de la ley (10 días corridos y 5 días hábiles, arts. 14 y 16 de la Ley 25.326).
- **`/alergenos`:** reescrito para decir lo que la app hace de verdad.
- Los datos que faltan se muestran en la página como `[Pendiente de definir antes del lanzamiento: …]` (`data-testid="pendiente-legal"`), no se inventan ni se omiten. El responsable se completa en `LEGAL_ENTITY` (`src/lib/legal.ts`).

## Normativa contrastada (fuentes oficiales)
- **Ley 24.240** (InfoLeg, texto actualizado): arts. 4 (información cierta, clara y detallada), 37 (se tienen por no convenidas las cláusulas que limitan la responsabilidad por daños o restringen derechos del consumidor), 40 (responsabilidad solidaria por daños de la cadena) y 10 bis.
- **Ley 25.326** (InfoLeg): arts. 4, 6 (informar finalidad, responsable y derechos), 12 (transferencia internacional), 14 (acceso: 10 días corridos), 16 (rectificación/supresión: 5 días hábiles), 21 (registro de archivos).
- **Celiaquía:** la Ley 27.196 (art. 1) incorporó el art. 4 bis a la Ley 26.588: ciertos establecimientos deben ofrecer al menos una opción o menú libre de gluten; el **Decreto 218/2023** la reglamenta y la **Disposición ANMAT 10867/2023** (Boletín Oficial, 13/12/2023) aprobó la «Guía de Recomendaciones para un Menú Libre de Gluten Seguro» para prevenir la contaminación cruzada. Es una obligación **del establecimiento**, no de la plataforma. El texto exacto del art. 4 bis y de la guía **no se pudo abrir** desde las fuentes oficiales (InfoLeg devolvió otros documentos); el contenido de la guía se leyó en una reproducción de terceros → un abogado debe contrastarlo con el Boletín Oficial.
- **Código Alimentario Argentino:** el rotulado es para alimentos **envasados**; no se lo aplicó a platos preparados. No se afirma ninguna obligación del CAA sobre cartas.
- UcoMenu **no usa el logo oficial «libre de gluten»** ni certifica: su etiqueta «Sin TACC» es una declaración del local.

## Pendiente — decisiones del usuario
1. **Responsable:** razón social, CUIT y domicilio (`LEGAL_ENTITY`) y correo de contacto (`NEXT_PUBLIC_CONTACT_EMAIL`).
2. **Plazos y procedimientos comerciales:** período de gracia y aviso de suspensión; cómo pide un local su baja; aviso previo de cambios de las condiciones; plazo interno y responsable de atender reportes.
3. **Conservación:** plazo de pedidos (2 años) y pagos (10 años) a confirmar con un contador; cuándo se borran las cuentas sin local; plazo del registro de auditoría y de los respaldos (y su cifrado); plazo de los registros de los proveedores.
4. **IA en producción:** proveedor definitivo (hoy Gemini gratuito solo con datos ficticios; Claude previsto).
5. **Etiquetas por sucursal:** hoy son de la organización. Si una sucursal tiene una cocina distinta, hace falta un ajuste por sucursal (migración). No se hizo.
6. **Observaciones de pedidos:** son texto libre y pueden incluir una alergia del comensal (dato de salud). Decidir si se orienta al personal a anotarlas (útil para seguridad) y cómo tratarlas.
7. **Registro de archivos de datos (art. 21 Ley 25.326)** y el marco de transferencias a Brasil (art. 12): consultar.
8. **Purgas sin programar** (`docs/produccion.md`, pasos 4, 4.b y 4.c): la política las promete.
9. **Limpieza de `rate_key`:** se anula solo al procesar el siguiente «me gusta» o comentario; si se quiere una hora exacta, hace falta una tarea programada (migración).

## Qué debe revisar un abogado argentino
Todo `/terminos`, `/privacidad` y `/alergenos`. En especial: la limitación a daños directos frente a locales (sección 6), el reparto de responsabilidad local/plataforma y la solidaridad del art. 40 de la Ley 24.240; si la plataforma es «responsable» o «encargada» del tratamiento y la inscripción de la base ante la AAIP; transferencias internacionales a Brasil y a los proveedores; el tratamiento de la alergia anotada en un pedido (dato sensible); la exposición por la etiqueta «Sin TACC» frente a las Leyes 26.588 y 27.196 y la guía ANMAT; la cláusula de jurisdicción; y el voseo y el tono de los textos.

## Aceptación
- [x] El pie, el detalle, el aviso del filtro y `/alergenos` no sugieren información que no existe y dicen que lo no etiquetado no es «apto».
- [x] El detalle de un plato etiquetado muestra «declarada, no certificada» y el contacto cruzado; con opciones, que pueden cambiarlas.
- [x] El estado sin resultados con etiquetas no afirma nada sobre el local.
- [x] Cambiar nombre/descripción (plato) o nombre (variante/adicional) quita la traducción de ese campo; guardar sin cambios la conserva.
- [x] Términos sin exención absoluta ni prioridad automática del personal; privacidad con responsable, plazos reales y procedimiento; pendientes visibles.

## Invariantes, fallos y recuperación
Sin cambios de permisos ni de esquema. La escritura de traducciones usa el cliente de la persona (RLS) y, si no se puede leer el valor actual, no guarda (`unexpected`). Una traducción quitada se recupera volviendo a cargarla en el panel; no hay borrado irreversible de datos de terceros. Reversión: revertir el commit.

## Evidencia
Diff probado en el commit de esta ficha (ver Git), sobre `98fc22b`.
- `pnpm typecheck`, `pnpm lint`: correctos. `pnpm test`: **1202/1202** (3 nuevas de `dropStaleTranslations`).
- `pnpm test:rls tests/rls/dietary.rls.test.ts tests/rls/opciones.rls.test.ts tests/rls/carta.rls.test.ts`: la nueva prueba de traducciones obsoletas **falla sin el arreglo y pasa con él**; `dietary` **7/7** (la primera corrida falló por la propia prueba, que heredaba una categoría inactiva de un caso anterior; corregida); `opciones` y `carta` pasaron.
- `pnpm build` y `pnpm exec playwright test e2e/legal.spec.ts e2e/buscador.spec.ts e2e/menu.spec.ts e2e/opciones.spec.ts e2e/idiomas.spec.ts --workers=2`: **51/51**. `e2e/carta.spec.ts e2e/carta-por-sucursal.spec.ts`: 29/30; la que falló (`en gracia se edita con normalidad`, que solo reordena platos) pasó sola al repetirla.
- No se hizo revisión independiente (nivel M). No se probó en un teléfono real ni con lector de pantalla. Sin cambios remotos.
