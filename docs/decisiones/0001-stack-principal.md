# 0001 — Stack principal: Next.js + Supabase

- Estado: aceptada. **Enmendada por la 0015 (2026-10-16): el hosting en Vercel se reemplaza por un contenedor en Fly.io** (Hobby no admite uso comercial y el sondeo de la sala encarece los hostings por pedido); Next.js + Supabase se mantienen.
- Fecha: 2026-10-13

## Contexto
UcoMenu es un SaaS multi-tenant mobile-first que necesita, desde el MVP: una carta pública muy rápida, aislamiento estricto entre organizaciones, tiempo real para el llamado al mozo, autenticación con roles y almacenamiento de archivos (fotos y, más adelante, modelos 3D). El equipo es chico: cada pieza de infraestructura propia es tiempo que no va al producto.

## Decisión
Next.js (App Router, TypeScript, Tailwind) desplegado en Vercel, con Supabase como backend: PostgreSQL con Row Level Security, Auth, Realtime y Storage.

## Alternativas consideradas
- **Next.js + backend propio (NestJS + Postgres + WebSockets)** — más control y portabilidad, pero obliga a construir y operar autenticación, servidor de sockets y almacenamiento antes de entregar valor.
- **Next.js + Firebase** — tiempo real muy simple, pero el modelo NoSQL complica el aislamiento por tenant, las relaciones de la carta y los reportes.

## Consecuencias
- Aislamiento multi-tenant, tiempo real, auth y archivos resueltos con un solo proveedor y poca infraestructura propia.
- La seguridad descansa en políticas RLS: escribirlas mal expone datos de otro tenant. Quedan obligadas las pruebas automáticas de aislamiento (ver ADR 0004).
- El comensal no abre conexiones en tiempo real: escribe por una función de base validada y solo el personal se suscribe. Así el costo de Realtime no escala con el público.
- Dependencia de Supabase y Vercel. Mitigación: los datos viven en Postgres estándar y las migraciones se versionan en el repo.
- La firma de pases de Wallet (fase 3) necesita runtime Node, no Edge.
- Versiones exactas y gestor de paquetes se fijan en el bootstrap y se registran en `AGENTS.md`.
