import type { MoraNotice } from "@/lib/entitlements";

const TONES: Record<MoraNotice["tone"], string> = {
  grace: "border-grace-edge bg-grace-bg text-grace-ink",
  read_only: "border-readonly-edge bg-readonly-bg text-readonly-ink",
  suspended: "border-suspended-edge bg-suspended-bg text-suspended-ink",
};

/** Aviso de mora del panel. Es informativo y se anuncia al cargar (`role="status"`). */
export function MoraBanner({ notice }: { notice: MoraNotice }) {
  return (
    <section
      role="status"
      aria-label="Estado de la cuenta"
      data-testid="mora-banner"
      data-tone={notice.tone}
      className={`border-l-4 px-4 py-4 ${TONES[notice.tone]}`}
    >
      <div className="mx-auto max-w-3xl">
        <p className="font-display text-xl leading-snug">{notice.title}</p>
        <p className="mt-1 max-w-prose text-base leading-relaxed">{notice.body}</p>
      </div>
    </section>
  );
}
