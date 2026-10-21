import { MOTIFS, motifPaint, type MotifName } from "@/lib/identidad/temas";

/** Motivo de un tema como ícono decorativo: `currentColor`, sin texto alternativo (siempre va junto a un saludo o es solo adorno). */
export function TemaIcono({ name, className = "size-5" }: { name: MotifName; className?: string }) {
  // El markup sale de `MOTIFS` (constantes de este código, nunca datos del local): es seguro insertarlo como HTML del SVG.
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={className} dangerouslySetInnerHTML={{ __html: `<g ${motifPaint(name, "currentColor")}>${MOTIFS[name].markup}</g>` }} />;
}
