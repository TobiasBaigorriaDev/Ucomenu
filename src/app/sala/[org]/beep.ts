/**
 * Alerta sonora de la sala: un doble pitido generado con Web Audio (sin archivos). Los navegadores solo dejan sonar
 * después de un gesto del usuario, por eso `unlock()` se llama desde el toque de «Activar alertas». Solo cliente.
 */

export type Beeper = {
  /** Crea y reanuda el contexto de audio. Devuelve `false` si el navegador no tiene Web Audio o lo rechaza. */
  unlock(): Promise<boolean>;
  /** Un doble pitido. No hace nada (ni falla) si el audio no está desbloqueado. */
  beep(): void;
  /** Libera el contexto. */
  close(): void;
};

export function createBeeper(): Beeper {
  let context: AudioContext | null = null;

  return {
    async unlock() {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        context ??= new Ctor();
        if (context.state === "suspended") await context.resume();
        return context.state === "running";
      } catch {
        return false;
      }
    },

    beep() {
      try {
        if (!context || context.state !== "running") return;
        const start = context.currentTime;
        for (const [offset, frequency] of [[0, 880], [0.22, 1175]] as const) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = frequency;
          // Entra y sale suave para que no «chasquee».
          gain.gain.setValueAtTime(0.0001, start + offset);
          gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(start + offset);
          oscillator.stop(start + offset + 0.22);
        }
      } catch {
        // Un fallo de audio nunca debe romper la pantalla.
      }
    },

    close() {
      try {
        void context?.close();
      } catch {
        // nada
      }
      context = null;
    },
  };
}
