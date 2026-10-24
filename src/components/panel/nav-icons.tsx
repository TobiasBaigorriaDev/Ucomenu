import type { ReactNode } from "react";

export type NavIcon =
  | "resumen"
  | "carta"
  | "mesas"
  | "llamados"
  | "promociones"
  | "videos"
  | "comentarios"
  | "apariencia"
  | "sucursales"
  | "suscripcion"
  | "analitica"
  | "personal"
  | "sala"
  | "panel"
  | "organizaciones"
  | "nueva";

// Íconos de trazo de 1,75 px, redondeados, en una grilla de 24: los mismos que usa la carta.
const PATHS: Record<NavIcon, ReactNode> = {
  resumen: (
    <>
      <rect x="3.5" y="3.5" width="7" height="8" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="2" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="2" />
      <rect x="3.5" y="14.5" width="7" height="6" rx="2" />
    </>
  ),
  carta: (
    <>
      <path d="M6 3.5h10.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M8 8.5h7M8 12h7M8 15.5h4" />
    </>
  ),
  mesas: (
    <>
      <path d="M4 9.5h16M6 9.5V20M18 9.5V20" />
      <path d="M7 9.5V6h10v3.5" />
    </>
  ),
  promociones: (
    <>
      <path d="M20 12.5 12.5 20a2 2 0 0 1-2.8 0L3.5 13.8V4.5a1 1 0 0 1 1-1h9.3l6.2 6.2a2 2 0 0 1 0 2.8Z" />
      <circle cx="8.5" cy="8.5" r="1.4" />
    </>
  ),
  llamados: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  videos: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M10 9.2v5.6l4.6-2.8L10 9.2Z" />
    </>
  ),
  comentarios: (
    <>
      <path d="M5.5 5h13a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5v-3.5h-1A1.5 1.5 0 0 1 4 15V6.5A1.5 1.5 0 0 1 5.5 5Z" />
    </>
  ),
  analitica: (
    <>
      <path d="M4 20.5h16" />
      <path d="M6.5 20.5v-6M12 20.5V8.5M17.5 20.5v-9.5" />
    </>
  ),
  apariencia: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.8 0-1.4-1-1.7-1-2.7 0-.9.7-1.5 1.7-1.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.6 16.8 3.5 12 3.5Z" />
      <circle cx="7.8" cy="11.5" r="1" />
      <circle cx="10.5" cy="7.8" r="1" />
      <circle cx="15" cy="8" r="1" />
    </>
  ),
  sucursales: (
    <>
      <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  suscripcion: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M3.5 10h17M7.5 14.5h3" />
    </>
  ),
  personal: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.8a3 3 0 0 1 0 5.4M17.5 14.4a5.5 5.5 0 0 1 3 5.1" />
    </>
  ),
  sala: (
    <>
      <path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  panel: (
    <>
      <path d="M4 20V10l8-6 8 6v10" />
      <path d="M9.5 20v-5.5h5V20" />
    </>
  ),
  organizaciones: (
    <>
      <path d="M4 20.5V8.5l8-4 8 4v12" />
      <path d="M9 20.5v-5h6v5M4 20.5h16" />
    </>
  ),
  nueva: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
};

export function NavGlyph({ name, className }: { name: NavIcon; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
