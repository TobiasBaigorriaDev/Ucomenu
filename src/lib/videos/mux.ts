/**
 * Frontera con Mux Video (ADR 0031). La parte A de la ficha videos-del-panel-base deja Mux detrás de esta interfaz para
 * poder construir y probar todo lo demás; la parte B agrega el cliente real (subida directa, webhook y borrado del asset)
 * con las credenciales `MUX_TOKEN_ID` y `MUX_TOKEN_SECRET`, que viven solo en el servidor.
 */
export interface MuxClient {
  /**
   * Borra el asset en Mux. Tiene que ser IDEMPOTENTE: si el asset ya no existe (404) no es un error, porque el borrado
   * de un video se reintenta cuando una vuelta anterior falló a mitad.
   */
  deleteAsset(assetId: string): Promise<void>;
}

/** El cliente de Mux del servidor, o `null` si no está configurado (todavía no lo está: parte B). */
export function getMuxClient(): MuxClient | null {
  return null;
}
