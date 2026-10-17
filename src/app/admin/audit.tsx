import type { AuditEntry } from "@/lib/admin/organizations";
import { CYCLE_LABEL, formatMoney, METHOD_LABEL } from "@/lib/admin/format";
import { formatDateWithYear, PLAN_NAME } from "@/lib/entitlements";

export const ACTION_LABEL: Record<string, string> = {
  "organization.created": "Alta de organización",
  "subscription.plan_changed": "Cambio de plan",
  "subscription.suspended": "Suspensión a mano",
  "subscription.reactivated": "Reactivación a mano",
  "payment.registered": "Pago registrado",
  "owner.added": "Dueño sumado",
};

const dateTime = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

const str = (value: unknown) => (typeof value === "string" && value ? value : null);

/** Datos que muestra cada movimiento, de lo que quedó en `after` (sin datos personales: ver la migración). */
function details(entry: AuditEntry): string[] {
  const after = entry.after ?? {};
  const out: string[] = [];
  const slug = str(after.slug);
  if (slug) out.push(slug);
  const plan = str(after.plan);
  const cycle = str(after.billing_cycle);
  if (plan) out.push(`${PLAN_NAME[plan] ?? plan}${cycle ? `, ${CYCLE_LABEL[cycle] ?? cycle}` : ""}`);
  if (entry.action === "payment.registered") {
    if (typeof after.amount_cents === "number" && str(after.currency)) out.push(formatMoney(after.amount_cents, String(after.currency)));
    const method = str(after.method);
    if (method) out.push(METHOD_LABEL[method] ?? method);
    const until = str(after.period_end);
    if (until) out.push(`cubre hasta el ${formatDateWithYear(until)}`);
  }
  const reason = str(after.reason);
  if (reason) out.push(`motivo: ${reason}`);
  return out;
}

export function AuditItem({ entry }: { entry: AuditEntry }) {
  const parts = details(entry);
  return (
    <li className="border-b border-ink/15 py-3" data-testid="auditoria">
      <p className="text-base break-words">
        <span className="font-medium">{ACTION_LABEL[entry.action] ?? entry.action}</span>
        {parts.length ? ` · ${parts.join(" · ")}` : ""}
      </p>
      <p className="mt-1 text-sm break-words text-muted">
        {dateTime.format(new Date(entry.createdAt))} · por {entry.actorEmail}
      </p>
    </li>
  );
}
