/**
 * Lo único que la carta guarda en el dispositivo del comensal, y solo cuando toca «me gusta» por primera vez (ficha likes-del-feed,
 * decisión 3; `/privacidad` lo dice): un código aleatorio de 128 bits y los videos que ya marcó (para pintar el corazón al volver).
 * El código identifica al navegador ante el servidor, que guarda solo su HMAC. Si el navegador no deja guardar (modo privado,
 * datos bloqueados), todo vive en memoria hasta cerrar la página: el like funciona igual.
 */

export const LIKES_STORAGE_KEY = "ucomenu:likes";
/** Tope de videos recordados: una organización tiene a lo sumo 50 (con borradores) y se guardan los últimos. */
const MAX_REMEMBERED = 100;

export type StoredLikes = { device: string | null; liked: readonly string[] };

export const EMPTY_LIKES: StoredLikes = { device: null, liked: [] };

const DEVICE = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lee lo guardado. Cualquier forma inesperada es «nada guardado»: nunca lanza. */
export function parseStoredLikes(raw: string | null): StoredLikes {
  if (!raw) return EMPTY_LIKES;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_LIKES;
    const { device, liked } = value as Record<string, unknown>;
    return {
      device: typeof device === "string" && DEVICE.test(device) ? device : null,
      liked: Array.isArray(liked) ? liked.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(-MAX_REMEMBERED) : [],
    };
  } catch {
    return EMPTY_LIKES;
  }
}

/** Un código aleatorio nuevo (128 bits, 32 hex). */
export function newDeviceCode(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  return Array.from(random(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** El estado con el video marcado o desmarcado (sin repetidos, con tope). */
export function withLike(state: StoredLikes, videoId: string, liked: boolean): StoredLikes {
  const rest = state.liked.filter((id) => id !== videoId);
  return { device: state.device, liked: liked ? [...rest, videoId].slice(-MAX_REMEMBERED) : rest };
}

// --- almacén del navegador (para `useSyncExternalStore`) ---------------------------------------------------------------

let current: StoredLikes | null = null;
const listeners = new Set<() => void>();

function load(): StoredLikes {
  if (current) return current;
  try {
    current = parseStoredLikes(window.localStorage.getItem(LIKES_STORAGE_KEY));
  } catch {
    current = EMPTY_LIKES;
  }
  return current;
}

function commit(next: StoredLikes) {
  current = next;
  try {
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento: queda en memoria.
  }
  listeners.forEach((listener) => listener());
}

export const getLikes = load;
export const getServerLikes = (): StoredLikes => EMPTY_LIKES;

export function subscribeLikes(onChange: () => void): () => void {
  listeners.add(onChange);
  // Otra pestaña del mismo sitio cambió lo guardado: se vuelve a leer.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LIKES_STORAGE_KEY) return;
    current = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** El código de este navegador; lo crea (y lo guarda) la primera vez que se pide, o sea al primer «me gusta». */
export function deviceCode(): string {
  const state = load();
  if (state.device) return state.device;
  const device = newDeviceCode();
  commit({ device, liked: state.liked });
  return device;
}

/** Recuerda (o olvida) que este navegador marcó el video. */
export function rememberLike(videoId: string, liked: boolean) {
  commit(withLike(load(), videoId, liked));
}
