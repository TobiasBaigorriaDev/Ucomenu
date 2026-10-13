# 0003 — Fidelización con pases de Wallet y cercanía nativa

- Estado: propuesta
- Fecha: 2026-10-13

> La mecánica (sellos por visita, validados por el personal) y el uso de Apple/Google Wallet están **aceptados**. La implementación queda como propuesta hasta emitir un pase de prueba en cada plataforma al iniciar la fase 3, lo que además requiere abrir las cuentas de emisor.

## Contexto
El plan Premium ofrece una tarjeta de fidelidad sin app y un recordatorio cuando el cliente pasa cerca del local. Una web no puede leer la ubicación en segundo plano, así que la cercanía solo es posible apoyándose en capacidades del sistema operativo.

## Decisión
Emitir la tarjeta como **pase nativo**: `.pkpass` tipo *storeCard* firmado por UcoMenu para Apple Wallet, y `LoyaltyClass`/`LoyaltyObject` para Google Wallet, con UcoMenu como **único emisor** para todos los tenants. La cercanía se delega al sistema: `locations` + `relevantText` en Apple y `merchantLocations` en Google, con las coordenadas de las sucursales. El saldo de sellos se actualiza por el web service de PassKit + APNs (Apple) y por la API REST (Google). Las promociones puntuales se envían como actualización del pase.

## Alternativas consideradas
- **Web Push con geolocalización** — inviable: los navegadores no exponen la ubicación en segundo plano; solo serviría con la web abierta.
- **App nativa con geofencing propio** — control total y métricas, pero contradice el producto (sin instalación) y multiplica costo y fricción.
- **Proveedor de pases como servicio (PassKit, Airship y similares)** — acelera la integración, pero con costo por pase que erosiona el margen de Premium y dependencia de un tercero. Se puede reevaluar si la implementación propia resulta costosa.
- **Un emisor por restaurante** — cada local tendría que abrir y mantener sus cuentas de Apple y Google. Inviable comercialmente.

## Consecuencias
- Sin app y sin rastrear ubicaciones: UcoMenu no almacena posiciones de clientes, lo que simplifica privacidad y cumplimiento.
- **La cercanía no se garantiza ni se mide.** Límites verificados:
  - Máximo 10 ubicaciones por pase en ambas plataformas.
  - Apple: acceso destacado al pase en pantalla de bloqueo con texto propio; el radio lo define Apple según el tipo de pase.
  - Google: Google decide radio, tiempo de permanencia y **texto** de la notificación; requiere notificaciones activas y permiso de ubicación precisa permanente para Google Wallet.
  - Hay que comunicarlo así al vender Premium: es un recordatorio, no una campaña de push.
- Requisitos externos y costos: Apple Developer Program (pago anual) y alta como emisor en Google Wallet con aprobación para producción.
- Operación: el certificado de pases de Apple vence cada año; los secretos viven solo en el gestor de secretos del hosting.
- Sumar sellos y canjear son operaciones nivel C: solo personal autenticado, con registro inmutable.
- Cambiar coordenadas de una sucursal obliga a regenerar o actualizar los pases emitidos.

## Fuentes
- https://developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications
- https://help.passkit.com/en/articles/2010114-how-many-locations-will-trigger-a-lock-screen-message
- https://help.passkit.com/en/articles/12441270-gps-location-notifications-google-wallet-vs-apple-wallet
