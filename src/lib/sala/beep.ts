/** Audios de sala y cocina. El contexto se desbloquea desde un gesto de la persona. */
export type NotificationSound = "notification" | "ready";
export const SOUND_FILES: Record<NotificationSound, string> = {
  notification: "/notificacion.mp3",
  ready: "/notificacion-plato-listo.mp3",
};

export type Beeper = {
  unlock(): Promise<boolean>;
  beep(sound?: NotificationSound): void;
  stop(): void;
  close(): void;
};

export function createBeeper(): Beeper {
  let context: AudioContext | null = null;
  let buffers: Record<NotificationSound, AudioBuffer> | null = null;
  let loading: Promise<void> | null = null;
  let playing: AudioBufferSourceNode | null = null;

  const stop = () => {
    try { playing?.stop(); } catch { /* El audio ya pudo haber terminado. */ }
    playing?.disconnect();
    playing = null;
  };

  return {
    async unlock() {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        context ??= new Ctor();
        // Reanudar antes de esperar la red: todavía estamos dentro del gesto.
        if (context.state === "suspended") await context.resume();
        const audio = context;
        if (!buffers) {
          loading ??= Promise.all(Object.entries(SOUND_FILES).map(async ([name, url]) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error("No se pudo cargar el audio.");
            return [name, await audio.decodeAudioData(await response.arrayBuffer())] as const;
          })).then((entries) => { buffers = Object.fromEntries(entries) as Record<NotificationSound, AudioBuffer>; });
          try { await loading; } finally { loading = null; }
        }
        return context?.state === "running";
      } catch {
        return false;
      }
    },

    beep(sound = "notification") {
      try {
        if (!context || context.state !== "running" || !buffers) return;
        stop();
        const source = context.createBufferSource();
        source.buffer = buffers[sound];
        source.connect(context.destination);
        source.onended = () => {
          source.disconnect();
          if (playing === source) playing = null;
        };
        playing = source;
        source.start();
      } catch {
        // Un fallo de audio nunca debe romper la pantalla.
      }
    },

    stop,
    close() {
      stop();
      void context?.close().catch(() => {});
      context = null;
      buffers = null;
    },
  };
}
