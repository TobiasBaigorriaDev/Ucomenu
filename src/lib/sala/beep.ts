import { TONE_FILES, toneById, type Note, type ToneId } from "./tonos";

/** Audios de sala y cocina. El contexto se desbloquea desde un gesto de la persona. */
export type Beeper = {
  unlock(): Promise<boolean>;
  beep(tone: ToneId): void;
  stop(): void;
  close(): void;
};

type Playing = { stop(): void };

/** Programa una nota con ataque y caída cortos para que no haya chasquidos. */
function schedule(context: AudioContext, output: AudioNode, note: Note, origin: number) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const start = origin + note.at;
  const end = start + note.length;
  oscillator.type = note.wave;
  oscillator.frequency.setValueAtTime(note.hz, start);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(note.gain, start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(envelope);
  envelope.connect(output);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
  return oscillator;
}

export function createBeeper(): Beeper {
  let context: AudioContext | null = null;
  let buffers: Partial<Record<ToneId, AudioBuffer>> | null = null;
  let loading: Promise<void> | null = null;
  let playing: Playing | null = null;

  const stop = () => {
    playing?.stop();
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
          loading ??= Promise.all(TONE_FILES.map(async ({ id, file }) => {
            const response = await fetch(file);
            if (!response.ok) throw new Error("No se pudo cargar el audio.");
            return [id, await audio.decodeAudioData(await response.arrayBuffer())] as const;
          })).then((entries) => { buffers = Object.fromEntries(entries); });
          try { await loading; } finally { loading = null; }
        }
        return context?.state === "running";
      } catch {
        return false;
      }
    },

    beep(id) {
      try {
        if (!context || context.state !== "running" || !buffers) return;
        const tone = toneById(id);
        stop();

        if ("file" in tone) {
          const buffer = buffers[tone.id as ToneId];
          if (!buffer) return;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          const handle: Playing = {
            stop() {
              try { source.stop(); } catch { /* El audio ya pudo haber terminado. */ }
              source.disconnect();
            },
          };
          source.onended = () => {
            source.disconnect();
            if (playing === handle) playing = null;
          };
          playing = handle;
          source.start();
          return;
        }

        const master = context.createGain();
        master.connect(context.destination);
        const origin = context.currentTime;
        const oscillators = tone.notes.map((note) => schedule(context!, master, note, origin));
        const handle: Playing = {
          stop() {
            for (const oscillator of oscillators) {
              try { oscillator.stop(); } catch { /* Ya había terminado. */ }
            }
            master.disconnect();
          },
        };
        // El que termina último cierra el tono (las notas se solapan: no es necesariamente la última de la lista).
        const lastIndex = tone.notes.reduce((best, note, index) => (note.at + note.length > tone.notes[best].at + tone.notes[best].length ? index : best), 0);
        oscillators[lastIndex].onended = () => {
          master.disconnect();
          if (playing === handle) playing = null;
        };
        playing = handle;
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
