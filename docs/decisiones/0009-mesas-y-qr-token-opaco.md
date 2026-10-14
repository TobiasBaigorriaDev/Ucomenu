# 0009 — Mesas y QR: token opaco generado por la base, resolución pública por función y regeneración por trigger

- Estado: aceptada
- Fecha: 2026-10-14

## Contexto
Cada mesa necesita un QR que lleve al comensal a la carta de su sucursal sabiendo en qué mesa está; más adelante ese mismo token identifica la mesa del «Llamado al mozo». El token no puede ser el número de mesa ni adivinable, tiene que poder regenerarse y la entrada es **pública y anónima**. Las escrituras siguen las reglas del catálogo (ADR 0005, 0006 y 0008): membresía, cuenta al día y tope por plan.

## Decisión
1. **Tabla `tables`** con clave foránea compuesta `(branch_id, organization_id)` a `branches`: una mesa nunca apunta a una sucursal ajena. Etiqueta de 1 a 40 caracteres, única por sucursal sin distinguir mayúsculas. **Sin borrado** desde la API: desactivar es la baja.
2. **El `qr_token` (32 hex = UUID v4 sin guiones, 122 bits) lo genera siempre la base.** La API no tiene permiso de `INSERT` sobre la columna; el permiso de `UPDATE` existe, pero un *trigger* `BEFORE UPDATE OF qr_token` **descarta el valor recibido y pone uno nuevo**. Regenerar el QR es «tocar» la columna: no hace falta una función `SECURITY DEFINER` para eso y nadie puede elegir un token adivinable. Mandar el valor actual no cambia nada.
3. **`anon` no tiene permiso ni política de lectura sobre `tables`** (si pudiera, listaría todos los tokens). La entrada pública `/t/{token}` usa `public.resolve_table_qr(p_token)`, `SECURITY DEFINER` con `search_path` vacío, que valida el formato y devuelve **solo** organización, sucursal, etiqueta, si la mesa está activa y si la carta está disponible, o `null`. Nunca ids, el token ni la causa de una suspensión.
4. **Comportamiento público:** token desconocido, malformado o regenerado → **404 idéntico**; mesa activa → carta con el número de mesa; **mesa inactiva** → carta sin número, como un link directo (el QR impreso no se rompe); cuenta **suspendida** → «Carta temporalmente no disponible»; **solo lectura** → funciona igual. La página no se indexa y no envía *referrer* (el token vive en la URL).
5. **Escrituras:** miembro de la organización y `org_can_write`, con el cliente de la persona (RLS). **Tope `tables_per_branch`** por *trigger* con *advisory lock* por sucursal: cuenta las mesas **activas**, bloquea crear una activa y activar una inactiva (desactivar siempre se permite) y **comprueba la membresía y que la sucursal sea de esa organización antes de contar**, para no filtrar el uso de otra organización (ADR 0006).
6. **QR:** `qrcode-generator` 2.0.4 (MIT, sin dependencias; aprobada el 2026-10-14). El servidor arma la matriz (corrección de errores M, zona de silencio de 4 módulos) y la dibuja como un único trazado SVG; la URL codificada es `{base}/t/{token}` con `base` = `NEXT_PUBLIC_SITE_URL` o, si no está definida, el host y protocolo del pedido (cabeceras validadas), nunca un parámetro.

## Alternativas consideradas
- **Función `SECURITY DEFINER` para regenerar el QR** — otra función en la API pública solo para hacer lo que un *trigger* hace sin superficie nueva.
- **Política de lectura para `anon` por token** — RLS no puede exigir «conocer el token»: una política `using (is_active)` expone todos los tokens a quien liste la tabla.
- **Token generado por la aplicación** — habría que confiar en que el servidor (o un cliente manipulado) elija bien; en la base es imposible equivocarse.
- **Token corto o numérico** — adivinable; los 122 bits hacen inviable la enumeración sin necesidad de límites de intentos.
- **Librería `qrcode` (3 dependencias) o un codificador propio** — más código de terceros o más código nuestro que mantener (un error produce QR que no escanean).

## Consecuencias
- **Un QR fotografiado sirve desde afuera del local** (riesgo ya registrado): se mitiga con regenerar y, en el ítem del llamado, con cooldown, un pendiente por tipo y límite por IP. El token identifica la mesa; por sí solo no autoriza ninguna escritura.
- **Sin cuota de intentos** sobre `resolve_table_qr`: lo cubre la entropía del token.
- Quien escriba el llamado al mozo debe resolver el token con la misma función (o una gemela), nunca leyendo `tables` con `anon`.
- Un local con mesas de más solo puede desactivarlas; el borrado llega con el historial de llamados.
- **Producción:** definir `NEXT_PUBLIC_SITE_URL` con el dominio definitivo (si no, el QR impreso apunta al dominio desde el que se abrió el panel). Los tokens del seed son fijos y **solo existen en desarrollo y pruebas**.
- Falta probar la lectura real del QR con un teléfono: la matriz y sus bits de formato se verifican en las pruebas, pero no hay un decodificador en el entorno.
