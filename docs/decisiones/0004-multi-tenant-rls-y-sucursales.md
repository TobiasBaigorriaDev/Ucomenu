# 0004 — Multi-tenancy: organización con sucursales, aislada por RLS

- Estado: aceptada
- Fecha: 2026-10-13

## Contexto
Cada cliente del SaaS debe ver solo sus datos. Además hay locales únicos y cadenas, y varias funciones dependen del local físico: mesas, QR, personal y coordenadas para la cercanía. Cambiar el modelo de tenancy con datos cargados es de las migraciones más costosas que existen, así que conviene fijarlo antes del primer esquema.

## Decisión
El tenant es la **organización**, que tiene una o más **sucursales**. Base y esquema compartidos: toda tabla de negocio lleva `organization_id` y tiene Row Level Security activado, con acceso por membresía. La carta pertenece a la organización y la disponibilidad se ajusta por sucursal. Mesas, QR, personal de sala y coordenadas pertenecen a la sucursal.

## Alternativas consideradas
- **Un tenant = un local** — más simple hoy, pero una cadena necesitaría una cuenta por local y migrar después a multi-sucursal es costoso.
- **Un esquema o una base por tenant** — aislamiento más fuerte, pero migraciones y operación se multiplican por cada cliente; desproporcionado para el tamaño de dato de un restaurante.
- **Filtrar por tenant solo en el código de aplicación** — un olvido en una consulta expone datos de otro cliente; RLS lo impide en la base.

## Consecuencias
- Soporta locales únicos (organización con una sucursal) y cadenas con el mismo modelo.
- El aislamiento lo garantiza la base, no la disciplina del código. A cambio, cada tabla nueva exige su política y su prueba de aislamiento entre dos organizaciones (nivel C).
- El comensal anónimo solo lee filas publicables y nunca escribe en tablas: las escrituras públicas pasan por funciones de base validadas.
- Las capacidades por plan se resuelven con una única función `has_feature(organization_id, feature)` usada por políticas, funciones y servidor.
- Identificación del tenant por ruta (`/m/{org}/{sucursal}`); subdominio o dominio propio quedan como evolución compatible.
