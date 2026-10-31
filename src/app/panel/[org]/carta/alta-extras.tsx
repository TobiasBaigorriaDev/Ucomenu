"use client";

import { useEffect, useRef, useState } from "react";
import { dangerButtonClass, inputClass, labelClass, secondaryButtonClass } from "@/components/panel/styles";
import { MAX_IMAGE_BYTES } from "@/lib/carta/images";
import { GROUP_TEMPLATES, MAX_CHOICES, MAX_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP } from "@/lib/carta/options-rules";
import { NAME_MAX } from "@/lib/carta/validation";
import { kb, shrink } from "./photo-form";

/**
 * Las piezas del alta unificada de un plato (ficha alta-unificada-de-platos): la foto y las variantes y adicionales se cargan en el
 * mismo formulario que los datos. Viven en el navegador hasta que se toca «Crear plato»; las comprueba y guarda `saveProductAction`.
 */

/**
 * Foto del plato nuevo (opcional). Se reduce en el navegador como en el editor. El archivo se guarda también en el estado: al terminar
 * la acción React vacía el campo de archivo, y si el alta falló (un error de validación, el cupo) se vuelve a poner para no pedirla de nuevo.
 * `submission` cambia cada vez que termina una acción.
 */
export function PhotoPicker({ submission }: { submission: unknown }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // La acción terminó con el alta sin hacerse: el campo quedó vacío, se repone la foto elegida.
  useEffect(() => {
    if (!file || !input.current || input.current.files?.length) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.current.files = transfer.files;
  }, [submission, file]);

  function clear() {
    if (input.current) input.current.value = "";
    setFile(null);
    setPreview(null);
    setNote(null);
  }

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const target = event.currentTarget;
    const original = target.files?.[0];
    setPreview(null);
    setFile(null);
    setNote(null);
    if (!original) return;

    setBusy(true);
    const prepared = await shrink(original);
    setBusy(false);
    if (prepared.size > MAX_IMAGE_BYTES) {
      target.value = "";
      setNote({ text: `La foto pesa ${kb(prepared.size)} y el máximo es ${kb(MAX_IMAGE_BYTES)}. Probá con otra.`, error: true });
      return;
    }
    if (prepared !== original) {
      const transfer = new DataTransfer();
      transfer.items.add(prepared);
      target.files = transfer.files;
    }
    setFile(prepared);
    setPreview(URL.createObjectURL(prepared));
    setNote({ text: `Foto lista (${kb(prepared.size)}).`, error: false });
  }

  return (
    <div className="grid gap-3" data-testid="alta-foto">
      <div>
        <label htmlFor="plato-foto" className={labelClass}>
          Foto <span className="font-normal text-muted">(opcional)</span>
        </label>
        <input
          ref={input}
          id="plato-foto"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onChange}
          className="mt-1 block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded-full file:border file:border-ink/40 file:bg-transparent file:px-4 file:text-base"
        />
      </div>
      {preview ? (
        // Vista previa local (blob:): no pasa por el optimizador de imágenes.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Vista previa de la foto elegida" className="aspect-[4/3] w-full max-w-md rounded-2xl border border-ink/15 object-cover" />
      ) : null}
      {busy ? <p className="text-sm text-muted">Preparando la foto…</p> : null}
      {note ? (
        <p role={note.error ? "alert" : undefined} className={`text-base ${note.error ? "font-medium text-danger" : "text-muted"}`}>
          {note.text}
        </p>
      ) : null}
      {file ? (
        <div>
          <button type="button" onClick={clear} className={secondaryButtonClass}>
            Quitar la foto
          </button>
        </div>
      ) : null}
    </div>
  );
}

type DraftOption = { key: number; name: string; delta: string };
type DraftGroup = { key: number; name: string; min: string; max: string; options: DraftOption[] };

/**
 * Variantes y adicionales del plato nuevo (opcional): grupos con sus opciones, con las mismas plantillas que el editor. Se envían en el
 * campo oculto `groups` (JSON). Los campos de acá no tienen `name`: lo único que viaja es ese JSON.
 */
export function GroupsBuilder() {
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const nextKey = useRef(1);
  const key = () => nextKey.current++;

  const patchGroup = (groupKey: number, patch: Partial<DraftGroup>) =>
    setGroups((current) => current.map((group) => (group.key === groupKey ? { ...group, ...patch } : group)));
  const patchOption = (groupKey: number, optionKey: number, patch: Partial<DraftOption>) =>
    setGroups((current) =>
      current.map((group) =>
        group.key === groupKey ? { ...group, options: group.options.map((option) => (option.key === optionKey ? { ...option, ...patch } : option)) } : group,
      ),
    );

  const json = JSON.stringify(groups.map(({ name, min, max, options }) => ({ name, min, max, options: options.map(({ name: n, delta }) => ({ name: n, delta })) })));
  const full = groups.length >= MAX_GROUPS_PER_PRODUCT;

  return (
    <div data-testid="alta-opciones">
      <input type="hidden" name="groups" value={json} />
      <p className="max-w-prose text-base text-muted">
        Una variante se elige entre varias (el tamaño, el punto de cocción). Los adicionales son extras opcionales. La carta muestra cada opción
        con su diferencia de precio, solo como información: el precio del plato sigue siendo el de arriba.
      </p>

      {groups.length > 0 ? (
        <ul className="mt-4 space-y-6">
          {groups.map((group, index) => (
            <li key={group.key} className="min-w-0 rounded-xl bg-sand px-4 py-4" data-testid="alta-grupo">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <label htmlFor={`alta-grupo-${group.key}-nombre`} className={labelClass}>
                    Nombre del grupo
                  </label>
                  <input
                    id={`alta-grupo-${group.key}-nombre`}
                    required
                    maxLength={NAME_MAX}
                    autoComplete="off"
                    value={group.name}
                    onChange={(event) => patchGroup(group.key, { name: event.target.value })}
                    className={`${inputClass} mt-1`}
                  />
                </div>
                <div>
                  <label htmlFor={`alta-grupo-${group.key}-min`} className={labelClass}>
                    Mínimo a elegir
                  </label>
                  <input
                    id={`alta-grupo-${group.key}-min`}
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    value={group.min}
                    onChange={(event) => patchGroup(group.key, { min: event.target.value })}
                    className={`${inputClass} mt-1`}
                  />
                </div>
                <div>
                  <label htmlFor={`alta-grupo-${group.key}-max`} className={labelClass}>
                    Máximo a elegir
                  </label>
                  <input
                    id={`alta-grupo-${group.key}-max`}
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    value={group.max}
                    onChange={(event) => patchGroup(group.key, { max: event.target.value })}
                    className={`${inputClass} mt-1`}
                  />
                </div>
              </div>
              <p className="mt-2 text-sm text-muted">
                Variante: mínimo 1 y máximo 1 (se elige una). Adicionales: mínimo 0 y máximo el que quieras (hasta {MAX_CHOICES}).
              </p>

              {group.options.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {group.options.map((option) => (
                    <li key={option.key} className="grid items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]" data-testid="alta-opcion">
                      <div>
                        <label htmlFor={`alta-opcion-${option.key}-nombre`} className={labelClass}>
                          Nombre de la opción
                        </label>
                        <input
                          id={`alta-opcion-${option.key}-nombre`}
                          required
                          maxLength={NAME_MAX}
                          autoComplete="off"
                          value={option.name}
                          onChange={(event) => patchOption(group.key, option.key, { name: event.target.value })}
                          className={`${inputClass} mt-1`}
                        />
                      </div>
                      <div>
                        <label htmlFor={`alta-opcion-${option.key}-delta`} className={labelClass}>
                          Diferencia de precio <span className="font-normal text-muted">(vacío = ninguna)</span>
                        </label>
                        <input
                          id={`alta-opcion-${option.key}-delta`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="300 o 1.250,50"
                          value={option.delta}
                          onChange={(event) => patchOption(group.key, option.key, { delta: event.target.value })}
                          className={`${inputClass} mt-1`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => patchGroup(group.key, { options: group.options.filter((o) => o.key !== option.key) })}
                        className={secondaryButtonClass}
                        aria-label={`Quitar la opción ${option.name || "sin nombre"} de ${group.name || "este grupo"}`}
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-base text-muted">Este grupo todavía no tiene opciones.</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={group.options.length >= MAX_OPTIONS_PER_GROUP}
                  onClick={() => patchGroup(group.key, { options: [...group.options, { key: key(), name: "", delta: "" }] })}
                  className={secondaryButtonClass}
                  data-testid="alta-agregar-opcion"
                >
                  Agregar opción
                </button>
                <button
                  type="button"
                  onClick={() => setGroups((current) => current.filter((g) => g.key !== group.key))}
                  className={dangerButtonClass}
                  aria-label={`Quitar el grupo ${group.name || String(index + 1)}`}
                >
                  Quitar grupo
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4">
        <p className={labelClass}>Agregar un grupo</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {GROUP_TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              disabled={full}
              onClick={() => setGroups((current) => [...current, { key: key(), name: template.name, min: template.min, max: template.max, options: [{ key: key(), name: "", delta: "" }] }])}
              className={secondaryButtonClass}
              data-testid={`alta-plantilla-${template.key}`}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
