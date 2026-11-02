/** Largo máximo de un slug. Debe coincidir con los CHECK de `organizations.slug` y `branches.slug`. */
export const SLUG_MAX_LENGTH = 64;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Mismo contrato que la base: minúsculas, dígitos y guiones simples, de 1 a 64 caracteres. */
export function isValidSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG.test(value);
}

/** Propone una dirección a partir de un nombre: sin tildes, en minúsculas y con guiones. Puede quedar vacía (un nombre sin letras). */
export function slugFromName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
}
