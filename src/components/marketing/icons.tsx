import type { ReactNode } from "react";

// Íconos de la portada: trazo de 1,75 px redondeado en un cuadro de 24, el mismo criterio de `panel/nav-icons.tsx`.
function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

export const IconCheck = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const IconArrow = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const IconBell = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 21h4" />
  </Icon>
);

export const IconReceipt = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" />
  </Icon>
);

export const IconChat = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M4 5h16v11H9l-5 4V5Z" />
  </Icon>
);

export const IconPlay = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m10.5 9.5 4 2.5-4 2.5v-5Z" />
  </Icon>
);

export const IconPin = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
    <circle cx="12" cy="11" r="2.2" />
  </Icon>
);

export const IconPlus = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
