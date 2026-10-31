"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass, secondaryButtonClass } from "@/components/panel/styles";
import { COOLDOWN_MAX, COOLDOWN_MIN, MUTE_OPTIONS } from "@/lib/llamados/config-rules";
import { previewTone } from "@/components/panel/sonido-llamados";
import { TONES, type AlertTones, type ToneId } from "@/lib/sala/tonos";
import { muteTableAction, setAlertTonesAction, setCooldownAction } from "./actions";

const summaryExtras = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";

/** Tiempo mínimo entre dos llamados del mismo tipo desde una mesa de la sucursal (solo el Dueño lo cambia). */
export function CooldownForm({
  orgSlug,
  branchId,
  branchName,
  seconds,
  canWrite,
}: {
  orgSlug: string;
  branchId: string;
  branchName: string;
  seconds: number;
  canWrite: boolean;
}) {
  return (
    <ActionForm action={setCooldownAction} className="mt-3 max-w-md">
      {(state) => (
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="branch" value={branchId} />
          <div>
            <label htmlFor={`cooldown-${branchId}`} className={labelClass}>
              Segundos entre llamados del mismo tipo en {branchName}
            </label>
            <input
              id={`cooldown-${branchId}`}
              name="seconds"
              type="number"
              inputMode="numeric"
              required
              min={COOLDOWN_MIN}
              max={COOLDOWN_MAX}
              step={1}
              defaultValue={state.values?.seconds ?? seconds}
              aria-describedby={`cooldown-ayuda-${branchId}`}
              className={`${inputClass} mt-1`}
            />
            <p id={`cooldown-ayuda-${branchId}`} className="mt-1 text-sm text-muted">
              Entre {COOLDOWN_MIN} y {COOLDOWN_MAX} segundos. Aplica por mesa: «Llamar al mozo» y «Pedir la cuenta» cuentan por separado.
            </p>
          </div>
          <div>
            <SubmitButton pendingLabel="Guardando…">Guardar</SubmitButton>
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}

/**
 * Controles de silencio de una mesa en UN solo formulario: «Quitar silencio» (si está silenciada) y «Silenciar» con
 * las duraciones. Es un único componente para que el mensaje de resultado sobreviva al refresco que sigue a guardar
 * (si «Quitar silencio» fuera un formulario aparte, desaparecería junto con su mensaje).
 */
export function MuteControls({
  orgSlug,
  id,
  label,
  canWrite,
  muted,
}: {
  orgSlug: string;
  id: string;
  label: string;
  canWrite: boolean;
  muted: boolean;
}) {
  const [state, formAction] = useActionState(muteTableAction, {});

  return (
    <form action={formAction} className="min-w-0 flex-1">
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-start gap-2">
        {muted ? <UnmuteButton label={label} canWrite={canWrite} /> : null}
        <details>
          <summary className={`${secondaryButtonClass} ${summaryExtras}`} aria-label={`Silenciar ${label}`}>
            Silenciar
          </summary>
          <fieldset disabled={!canWrite} className="mt-3 max-w-md">
            <p className="text-base leading-relaxed">
              Mientras esté silenciada, {label} no muestra los botones de llamado. Usalo ante abuso; el resto de la carta sigue
              igual.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {MUTE_OPTIONS.map((option) => (
                <MuteButton key={option.minutes} minutes={option.minutes} text={option.label} label={label} />
              ))}
            </div>
          </fieldset>
        </details>
      </div>
      <Feedback state={state} />
    </form>
  );
}

function MuteButton({ minutes, text, label }: { minutes: number; text: string; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="minutes"
      value={minutes}
      disabled={pending}
      aria-label={`Silenciar ${label} por ${text}`}
      className={`${secondaryButtonClass} min-w-11`}
    >
      {text}
    </button>
  );
}

function UnmuteButton({ label, canWrite }: { label: string; canWrite: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value="unmute"
      disabled={!canWrite || pending}
      aria-label={`Quitar el silencio de ${label}`}
      className={`${secondaryButtonClass} min-w-11`}
    >
      Quitar silencio
    </button>
  );
}

function Feedback({ state }: { state: { error?: string; message?: string } }) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="mt-2 text-base font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="mt-2 text-sm text-muted">
          {state.message}
        </p>
      ) : null}
    </>
  );
}

const TONE_GROUPS = [
  { name: "call", legend: "Cuando una mesa llama", help: "Suena al mozo si una mesa llama o pide la cuenta, y al cocinero cuando entra un plato nuevo." },
  { name: "ready", legend: "Cuando un pedido está listo", help: "Suena al mozo cuando cocina termina todos los platos de un pedido." },
] as const;

/** Tonos de aviso del local: uno para el llamado de mesa y otro para el pedido listo (solo el Dueño los cambia). */
export function TonosForm({ orgSlug, tones, canWrite }: { orgSlug: string; tones: AlertTones; canWrite: boolean }) {
  const [heard, setHeard] = useState<string | null>(null);

  async function listen(id: ToneId, label: string) {
    const played = await previewTone(id);
    setHeard(played ? `Sonando: ${label}.` : "Tu navegador no dejó reproducir el sonido. Tocá de nuevo o revisá que el volumen esté activado.");
  }

  return (
    <ActionForm action={setAlertTonesAction} className="mt-3 max-w-2xl">
      {(state) => (
        <fieldset disabled={!canWrite} className="grid gap-6">
          <input type="hidden" name="org" value={orgSlug} />
          {TONE_GROUPS.map((group) => (
            <fieldset key={group.name} className="grid gap-1" data-testid={`tonos-${group.name}`}>
              <legend className="text-lg font-medium">{group.legend}</legend>
              <p className="text-sm text-muted">{group.help}</p>
              <ul className="mt-2 grid gap-1">
                {TONES.map((tone) => {
                  const inputId = `tono-${group.name}-${tone.id}`;
                  return (
                    <li key={tone.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/10 py-1">
                      <label htmlFor={inputId} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-base">
                        <input
                          id={inputId}
                          type="radio"
                          name={group.name}
                          value={tone.id}
                          defaultChecked={(state.values?.[group.name] ?? tones[group.name]) === tone.id}
                          className="size-5 shrink-0 accent-brand"
                        />
                        <span className="min-w-0">
                          <span className="font-medium">{tone.label}</span>
                          <span className="block text-sm text-muted">{tone.hint}</span>
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => void listen(tone.id, tone.label)}
                        className={secondaryButtonClass}
                        aria-label={`Escuchar ${tone.label}`}
                        data-testid={`escuchar-${group.name}-${tone.id}`}
                      >
                        Escuchar
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
          <p aria-live="polite" className="min-h-5 text-sm text-muted" data-testid="tono-escuchado">
            {heard}
          </p>
          <div>
            <SubmitButton pendingLabel="Guardando…">Guardar tonos</SubmitButton>
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}
