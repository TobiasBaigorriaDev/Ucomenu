import { afterEach, describe, expect, it, vi } from "vitest";
import { contactEmail, LEGAL_CONTACT_EMAIL, LEGAL_UPDATED_AT, LEGAL_VERSION } from "./legal";
import { TERMS_VERSION } from "./registro/registro";

afterEach(() => vi.unstubAllEnvs());

describe("contacto legal", () => {
  it("usa el contacto aprobado si el contenedor no recibe la variable pública", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", undefined);
    expect(contactEmail()).toBe(LEGAL_CONTACT_EMAIL);
  });

  it("respeta el contacto del entorno y rechaza un valor inválido", () => {
    expect(contactEmail({ NEXT_PUBLIC_CONTACT_EMAIL: "  contacto@example.com  " })).toBe("contacto@example.com");
    expect(contactEmail({ NEXT_PUBLIC_CONTACT_EMAIL: "sin-arroba" })).toBeNull();
    // Vacío explícito es configuración inválida; no se oculta con el predeterminado.
    expect(contactEmail({ NEXT_PUBLIC_CONTACT_EMAIL: "" })).toBeNull();
  });
});

it("el alta registra la versión legal que corresponde a la fecha pública", () => {
  expect(TERMS_VERSION).toBe(LEGAL_VERSION);
  expect(LEGAL_UPDATED_AT).toBe(new Intl.DateTimeFormat("es-AR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${TERMS_VERSION}T00:00:00Z`)));
});
