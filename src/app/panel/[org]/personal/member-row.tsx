import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { ROLE_LABEL } from "@/components/panel/app-shell";
import { PasswordField } from "@/components/panel/password-field";
import { dangerButtonClass, secondaryButtonClass } from "@/components/panel/styles";
import type { Role } from "@/lib/entitlements";
import type { Member } from "@/lib/personnel";
import { removeMemberAction, resetPasswordAction, setBranchesAction, setRoleAction } from "./actions";

const summaryExtras = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
const summaryClass = `${secondaryButtonClass} ${summaryExtras}`;
const dangerSummaryClass = `${dangerButtonClass} ${summaryExtras}`;

/** A qué otros roles se puede pasar a alguien, con el texto del botón. */
const ROLE_MOVES: Record<Role, { to: Role; label: string }[]> = {
  owner: [
    { to: "staff", label: "Pasar a personal" },
    { to: "cook", label: "Pasar a cocina" },
  ],
  staff: [
    { to: "owner", label: "Hacer dueño" },
    { to: "cook", label: "Pasar a cocina" },
  ],
  cook: [
    { to: "staff", label: "Pasar a personal" },
    { to: "owner", label: "Hacer dueño" },
  ],
};

/** Una persona del equipo con sus acciones. Los formularios llaman a server actions que revalidan el rol. */
export function MemberRow({ member, orgSlug, branches }: { member: Member; orgSlug: string; branches: { id: string; name: string }[] }) {
  const { membershipId, email, role, isSelf, sharedAccount, assignedBranchIds } = member;
  // Solo Staff y cocina, y solo si hay de dónde elegir (ficha personal-por-sucursal).
  const canAssign = role !== "owner" && branches.length > 1;
  const assigned = branches.filter((branch) => assignedBranchIds.includes(branch.id));
  const hidden = (
    <>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="membership" value={membershipId} />
    </>
  );

  return (
    <li className="border-b border-ink/15 py-4" data-testid="member-row" data-email={email}>
      <div className="flex items-baseline gap-3 text-lg">
        <span className="min-w-0 font-medium break-all">{email}</span>
        <span aria-hidden className="leader" />
        <span className="shrink-0 text-base text-muted">{ROLE_LABEL[role]}</span>
      </div>

      {canAssign ? (
        <p className="mt-1 text-sm text-muted" data-testid="member-sucursales">
          {assigned.length === 0 ? "Ve todas las sucursales." : `Solo ve: ${assigned.map((branch) => branch.name).join(", ")}.`}
        </p>
      ) : null}

      {isSelf ? (
        <p className="mt-1 text-sm text-muted">Esta es tu cuenta. Cambiá tu contraseña desde Mi cuenta.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {ROLE_MOVES[role].map((move) => (
            <ActionForm key={move.to} action={setRoleAction}>
              {hidden}
              <input type="hidden" name="role" value={move.to} />
              <SubmitButton className={secondaryButtonClass}>{move.label}</SubmitButton>
            </ActionForm>
          ))}

          {canAssign ? (
            <details className="w-full sm:w-auto">
              <summary className={summaryClass}>Sucursales</summary>
              <ActionForm action={setBranchesAction} className="mt-3 grid max-w-md gap-3">
                {hidden}
                <fieldset className="grid gap-1">
                  <legend className="text-base leading-relaxed">
                    Elegí las sucursales que ve en pantalla. Sin ninguna elegida, ve todas.
                  </legend>
                  {branches.map((branch) => (
                    <label key={branch.id} className="flex min-h-11 items-center gap-3 text-base">
                      <input
                        type="checkbox"
                        name="branch"
                        value={branch.id}
                        defaultChecked={assignedBranchIds.includes(branch.id)}
                        className="size-5 accent-cobalt"
                      />
                      {branch.name}
                    </label>
                  ))}
                </fieldset>
                <p className="text-sm text-muted">
                  Es un límite de lo que ve en las pantallas de sala y cocina y de los avisos del celular, no un permiso de seguridad.
                </p>
                <div>
                  <SubmitButton>Guardar sucursales</SubmitButton>
                </div>
              </ActionForm>
            </details>
          ) : null}

          {role !== "owner" && !sharedAccount ? (
            <details className="w-full sm:w-auto">
              <summary className={summaryClass}>Cambiar contraseña</summary>
              <ActionForm action={resetPasswordAction} className="mt-3 grid max-w-md gap-3">
                {hidden}
                <PasswordField name="password" label="Contraseña nueva" autoComplete="new-password" />
                <div>
                  <SubmitButton>Guardar contraseña</SubmitButton>
                </div>
              </ActionForm>
            </details>
          ) : null}

          <details className="w-full sm:w-auto">
            <summary className={dangerSummaryClass}>Quitar</summary>
            <ActionForm action={removeMemberAction} className="mt-3 max-w-md">
              {hidden}
              <p className="text-base leading-relaxed">
                {email} pierde el acceso de inmediato.
                {sharedAccount ? " Su cuenta sigue activa porque se usa también fuera de este local." : " Su cuenta se elimina."}
              </p>
              <div className="mt-3">
                <SubmitButton className={dangerButtonClass} pendingLabel="Quitando…">
                  Sí, quitar
                </SubmitButton>
              </div>
            </ActionForm>
          </details>
        </div>
      )}

      {!isSelf && role !== "owner" && sharedAccount ? (
        <p className="mt-2 text-sm text-muted">Su cuenta se usa también fuera de este local: su contraseña no se cambia desde acá.</p>
      ) : null}
    </li>
  );
}
