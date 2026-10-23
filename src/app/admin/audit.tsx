import type { AuditEntry } from "@/lib/admin/organizations";
import { CYCLE_LABEL, formatMoney, METHOD_LABEL } from "@/lib/admin/format";
import { PREVIEW_FEATURE_LABEL, isPreviewFeature } from "@/lib/admin/validation";
import { formatDateWithYear, PLAN_NAME } from "@/lib/entitlements";

export const ACTION_LABEL: Record<string, string> = {
  "organization.created": "Alta de organización",
  "subscription.plan_changed": "Cambio de plan",
  "subscription.suspended": "Suspensión a mano",
  "subscription.reactivated": "Reactivación a mano",
  "payment.registered": "Pago registrado",
  "payment.voided": "Pago anulado",
  "owner.added": "Dueño sumado",
  "organization.deactivated": "Baja de la organización",
  "organization.reactivated": "Organización reactivada",
  "addon.activated": "Add-on activado",
  "addon.changed": "Add-on modificado",
  "addon.ended": "Add-on finalizado",
  "payments.purged": "Pagos antiguos purgados",
  "organization.deleted": "Organización borrada",
  "account.deleted": "Cuenta sin local borrada",
  "feature_preview.started": "Vista previa de función iniciada",
  "feature_preview.changed": "Vista previa de función modificada",
  "feature_preview.ended": "Vista previa de función finalizada",
};

// WebAR ya no está en el catálogo (ADR 0031), pero sus movimientos siguen en la auditoría y se nombran.
const ADDON_NAME: Record<string, string> = { webar: "WebAR", extra_branch: "Sucursal adicional" };

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
  if (entry.action === "payment.voided") {
    if (typeof after.amount_cents === "number" && str(after.currency)) out.push(formatMoney(after.amount_cents, String(after.currency)));
    const until = str(after.period_end);
    if (until) out.push(`vencimiento vuelto al ${formatDateWithYear(until)}`);
  }
  if (entry.action === "payments.purged") {
    if (typeof after.payments === "number") out.push(`${after.payments} pagos`);
    if (typeof after.voids === "number" && after.voids > 0) out.push(`${after.voids} anulaciones`);
    const before = str(after.registered_before);
    if (before) out.push(`registrados antes del ${formatDateWithYear(before)}`);
  }
  if (entry.action === "organization.deleted") {
    // Con el nombre y el id se identifican los pagos que quedan sin organización (ADR 0027) y sus archivos de Storage.
    const name = str(after.name);
    if (name) out.push(`«${name}»`);
    if (entry.organizationId) out.push(`id ${entry.organizationId}`);
    if (typeof after.payments_kept === "number" && after.payments_kept > 0) out.push(`${after.payments_kept} pagos conservados`);
    if (typeof after.price_history_purged === "number") out.push(`${after.price_history_purged} cambios de precio purgados`);
    if (typeof after.promotion_history_purged === "number" && after.promotion_history_purged > 0)
      out.push(`${after.promotion_history_purged} cambios de promociones purgados`);
  }
  if (entry.action === "account.deleted") {
    // Solo el id: el email de la cuenta borrada no se guarda (convención de la auditoría).
    const account = str(after.user_id);
    if (account) out.push(`cuenta ${account}`);
  }
  if (entry.action.startsWith("addon.")) {
    const addon = str(after.addon);
    if (addon) out.push(ADDON_NAME[addon] ?? addon);
    const sucursales = addon === "extra_branch";
    if (typeof after.extra_packs === "number") {
      out.push(sucursales ? `${after.extra_packs} ${after.extra_packs === 1 ? "sucursal adicional" : "sucursales adicionales"}` : `${after.extra_packs} packs extra`);
    }
    const ends = str(after.ends_at);
    if (entry.action === "addon.ended") {
      if (ends) out.push(`finalizado el ${formatDateWithYear(ends)}`);
    } else if (!sucursales) {
      out.push(ends ? `termina el ${formatDateWithYear(ends)}` : "sin fecha de fin");
    }
    // Sucursales que se desactivaron en el mismo movimiento (solo el identificador: el nombre puede cambiar).
    if (Array.isArray(after.deactivated_branches) && after.deactivated_branches.length > 0) {
      const slugs = after.deactivated_branches
        .map((branch) => (typeof branch === "object" && branch !== null && "slug" in branch ? str((branch as { slug: unknown }).slug) : null))
        .filter((slug): slug is string => slug !== null);
      if (slugs.length > 0) out.push(`desactivadas: ${slugs.join(", ")}`);
    }
  }
  if (entry.action.startsWith("feature_preview.")) {
    const feature = str(after.feature);
    if (feature) out.push(isPreviewFeature(feature) ? PREVIEW_FEATURE_LABEL[feature] : feature);
    const ends = str(after.ends_at);
    if (ends) out.push(entry.action === "feature_preview.ended" ? `finalizada el ${formatDateWithYear(ends)}` : `hasta el ${formatDateWithYear(ends)}`);
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
