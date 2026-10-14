/** Resultado que devuelven las server actions de formularios a `ActionForm`. */
export type FormState = {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Valores que se vuelven a mostrar tras un error (nunca contraseñas). */
  values?: Record<string, string>;
};
