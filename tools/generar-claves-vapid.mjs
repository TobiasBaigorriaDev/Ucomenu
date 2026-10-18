// Genera un par de claves VAPID (P-256) para el aviso de llamados por Web Push (ADR 0020).
// Uso:  pnpm push:claves
// Imprime las variables; NO escribe ningún archivo. Copiá las tres a .env.local (desarrollo) o a los secretos del
// servidor (en Fly: `fly secrets set VAPID_PRIVATE_KEY=...`). La privada es un SECRETO: no va a Git ni a la imagen.
// Cada entorno (local, staging, producción) usa su propio par: cambiarlo invalida las suscripciones de los dispositivos.
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const base64url = (buffer) => buffer.toString("base64url");

console.log("# Pegá estas líneas en .env.local (o en los secretos del servidor). La privada NO se comparte ni se commitea.");
console.log(`VAPID_PUBLIC_KEY=${base64url(ecdh.getPublicKey())}`);
console.log(`VAPID_PRIVATE_KEY=${base64url(ecdh.getPrivateKey())}`);
console.log("VAPID_SUBJECT=mailto:contacto@tu-dominio.com");
