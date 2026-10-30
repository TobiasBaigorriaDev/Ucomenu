# Imagen de producción de UcoMenu (ADR 0015, docs/operacion.md): Node + Next.js en modo «standalone».
# Un contenedor corre igual en Fly.io, en un VPS o en cualquier servicio de contenedores: no hay dependencia de un proveedor.
#
# Las variables NEXT_PUBLIC_* se incrustan AL CONSTRUIR (son públicas): una imagen por entorno (staging y producción).
# Los secretos de servidor (SUPABASE_SERVICE_ROLE_KEY, WAITER_CALL_CLIENT_SECRET) NO se copian a la imagen: se pasan al
# arrancar (en Fly: `fly secrets set`). Construcción de ejemplo:
#   docker build -t ucomenu:staging \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave pública> \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://<dominio> \
#     --build-arg NEXT_PUBLIC_CONTACT_EMAIL=<correo> .
# syntax=docker/dockerfile:1

FROM node:24-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# La versión de pnpm es la fijada en package.json (packageManager).
RUN npm install -g pnpm@11.19.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CONTACT_EMAIL
ARG NEXT_PUBLIC_DEMO_CARTA_PATH
ENV NEXT_OUTPUT=standalone
RUN pnpm build

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# Salida mínima de Next (servidor y solo las dependencias que usa) + archivos estáticos con hash.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Archivos públicos (el service worker del aviso de llamados, public/sala-sw.js): el modo standalone no los copia solo.
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
