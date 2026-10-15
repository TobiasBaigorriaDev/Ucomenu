import type { Metadata } from "next";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { configBlockNotice, NOT_ENABLED_NOTICE } from "@/lib/llamados/config-messages";
import { COOLDOWN_MAX, COOLDOWN_MIN, formatMuteEnd, isMuted } from "@/lib/llamados/config-rules";
import { loadLlamadoConfig } from "@/lib/llamados/config";
import { createSessionClient } from "@/lib/supabase/server";
import { CooldownForm, MuteControls } from "./config-forms";

export const metadata: Metadata = { title: "Configuración del llamado" };

const badgeClass = "inline-flex items-center rounded-sm border border-ink/40 px-2 py-0.5 text-sm text-ink";

export default async function LlamadosPage({ params }: PageProps<"/panel/[org]/llamados">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/panel/${org}/llamados`);
  const db = await createSessionClient();

  const [branches, ent] = await Promise.all([loadLlamadoConfig(db, membership.org.id), getEntitlements(membership.org.id)]);
  // Si no se pudo leer el estado de la cuenta, falla cerrado: se muestra pero no se edita.
  const canWrite = ent?.canWrite === true;
  const notice = configBlockNotice(ent);
  const isOwner = membership.role === "owner";
  const callsEnabled = ent?.features.includes("waiter_call") === true;
  const now = new Date();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Configuración del llamado</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Ajustá cada cuánto puede avisar una mesa y silenciá las mesas que abusen del llamado al mozo.
      </p>
      {ent ? null : (
        <p className="mt-2 text-base text-muted">No pudimos comprobar el estado de la cuenta, así que la edición está desactivada.</p>
      )}
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="llamados-bloqueados">
          {notice}
        </p>
      ) : null}
      {ent && !callsEnabled ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="llamado-inactivo">
          {NOT_ENABLED_NOTICE}
        </p>
      ) : null}

      {branches.length === 0 ? <p className="mt-10 max-w-prose text-lg text-muted">Este local todavía no tiene sucursales.</p> : null}

      {branches.map((branch) => (
        <section
          key={branch.id}
          aria-labelledby={`suc-${branch.id}`}
          className="mt-12 border-t-2 border-ink/30 pt-5"
          data-testid="sucursal"
          data-name={branch.name}
        >
          <h2 id={`suc-${branch.id}`} className="font-display text-3xl leading-tight break-words">
            {branch.name}
          </h2>

          <h3 className="mt-4 text-xl font-medium">Tiempo entre llamados</h3>
          {isOwner ? (
            <CooldownForm
              orgSlug={membership.org.slug}
              branchId={branch.id}
              branchName={branch.name}
              seconds={branch.cooldown}
              canWrite={canWrite}
            />
          ) : (
            <p className="mt-2 max-w-prose text-base" data-testid="cooldown-lectura">
              <span className="font-medium tabular-nums">{branch.cooldown} segundos</span> entre llamados del mismo tipo desde una
              misma mesa (entre {COOLDOWN_MIN} y {COOLDOWN_MAX}). Lo define el Dueño del local.
            </p>
          )}

          <h3 className="mt-8 text-xl font-medium">Mesas</h3>
          {branch.tables.length > 0 ? (
            <ul className="mt-2 border-t border-ink/15">
              {branch.tables.map((table) => {
                const muted = isMuted(table.muted_until, now);
                return (
                  <li key={table.id} className="border-b border-ink/15 py-4" data-testid="mesa" data-label={table.label}>
                    <p className="text-lg font-medium break-words">{table.label}</p>
                    {table.is_active && !(muted && table.muted_until) ? null : (
                      // Los estados van en su propia fila y pasan a otra línea: con nombre largo y dos estados el nombre no se aprieta.
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {table.is_active ? null : <span className={badgeClass}>Inactiva</span>}
                        {muted && table.muted_until ? (
                          <span className={badgeClass} data-testid="silenciada">
                            Silenciada hasta {formatMuteEnd(table.muted_until, now)}
                          </span>
                        ) : null}
                      </div>
                    )}
                    {table.is_active ? null : (
                      <p className="mt-1 text-sm text-muted">Una mesa inactiva no admite llamados.</p>
                    )}
                    <div className="mt-3">
                      <MuteControls orgSlug={membership.org.slug} id={table.id} label={table.label} canWrite={canWrite} muted={muted} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-base text-muted">Esta sucursal todavía no tiene mesas.</p>
          )}
        </section>
      ))}
    </main>
  );
}
