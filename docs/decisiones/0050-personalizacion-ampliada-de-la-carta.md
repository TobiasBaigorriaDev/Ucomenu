# 0050 — Personalización ampliada de la carta: opciones curadas, nunca selectores libres

- Estado: aceptada (propuesta y pedida por el usuario el 2026-10-30; sin desplegar)
- Fecha: 2026-10-30

## Contexto
La identidad del local ya tenía paleta, estilo de composición, tema de fecha y logo (ADR 0036 y 0037). El Dueño pidió que la carta se sienta mucho más propia sin romper la legibilidad, el contraste AA ni la velocidad en el celular del comensal. Se exploraron cinco herramientas nuevas y se implementaron todas.

## Decisión
1. **Todo es un conjunto cerrado.** Cada opción nueva es una clave con `check` en la base y un catálogo en `src/lib/identidad/`; no hay colores, fuentes ni medidas libres. Lo que falta o es desconocido cae al valor predeterminado, y la carta de un local que no toca nada se ve igual que antes.
2. **Tipografía (`menu_font`, 6 voces).** Cambia solo la fuente de los títulos (nombre del local, categorías, nombre de plato). El texto de lectura sigue en Schibsted Grotesk. Las fuentes no se precargan y `next/font` genera la métrica de reemplazo, así que una carta solo descarga la voz que usa. `scale` achica el nombre del local en las fuentes anchas. «Afiche» conserva su condensada propia.
3. **Forma y densidad (`menu_shape`, `menu_density`).** Esquinas (suave, recta, filete) y espaciado (aireada, compacta) por clases-gancho (`carta-pieza`, `carta-pildora`, …) y atributos `data-*`; no cambian colores y respetan el `min-h-11`. «Afiche» no cambia con la forma.
4. **Ambientación (`menu_ambient`).** Textura de fondo y adornos del pie con la misma técnica y la misma opacidad (`PATTERN_OPACITY`, 0,07) que los temas de fecha; el peor caso de contraste AA se prueba en las 12 paletas. **Con un tema de fecha vigente, el tema reemplaza a la textura** (nunca se superponen).
5. **Voz del local (`menu_tagline`, `opening_hours`, `instagram_handle`, `whatsapp_number`).** Texto plano de una línea (80 y 160 caracteres, sin controles ni marcas invisibles de dirección o ancho cero) y **solo identificadores**: la base guarda el usuario de Instagram y los dígitos del número; el servidor arma `instagram.com/{usuario}` y `wa.me/{número}`. No existe un campo de dirección libre, así que no hay forma de guardar un enlace a otro sitio. Los horarios son los de la organización, no por sucursal. El lema no se traduce. Es información que el local decide publicar; el panel avisa que es pública y que no use teléfonos personales.
6. **Portada (`cover_path`).** Una foto horizontal arriba de la carta, **sin texto encima**: el contraste del nombre no depende de la foto. Vive en el bucket y las políticas del logo (misma forma de ruta, mismo Dueño con cuenta editable), con su propia función de reemplazo (`replace_organization_cover`) y un `check` de fila que impide que `cover_path` y `logo_path` sean el mismo archivo (el reemplazo borra la referencia saliente). Al heredar el bucket, entra sola en el borrado de organizaciones, el respaldo y `next.config.ts`. Sin cupo por plan por ahora; proporción fija 16:9 con `priority` (suele ser lo primero que se ve).

## Alternativas descartadas
- Selector libre de color, fuente o radio: rompe el contraste y la carga; fue lo que se quiso evitar.
- Bucket nuevo para portadas: sumaba políticas, respaldo y borrado sin ganar aislamiento real.
- Enlaces escritos por el Dueño: abren una vía de redirección o suplantación; los identificadores validados la cierran.
- Horarios por sucursal: más tablas y formularios; se deja para cuando un local lo pida.

## Consecuencias
- Agregar una opción = una entrada en su catálogo, ampliar el `check` en una migración y, en la tipografía, la fuente y su regla `.carta[data-fuente]`. Una prueba compara las listas de la migración con las del código.
- `loadIdentity` y la carta pública leen más columnas de `organizations`; no hay tablas nuevas.
- Los textos de contacto de la carta salen en es/en/pt; lo que escribe el local, tal cual.
- Queda fuera, por decisión: colores o fuentes libres, subir fuentes propias, más de una foto, video de portada, cupo por plan, horarios por sucursal, traducir el lema.
