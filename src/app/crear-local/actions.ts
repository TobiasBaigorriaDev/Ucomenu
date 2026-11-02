"use server";

import { redirect } from "next/navigation";
import { parseName, parseSlug } from "@/lib/admin/validation";
import { requireUser } from "@/lib/auth/session";
import { PASSWORD_PROBLEM_MESSAGE, validatePassword } from "@/lib/auth/validation";
import type { FormState } from "@/lib/form-state";
import { authMethods, FIRST_BRANCH, mustChoosePassword, SELF_REGISTER_MESSAGE, selfRegisterErrorFrom, TERMS_VERSION } from "@/lib/registro/registro";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Crea el local de quien se registró (ficha registro-autoservicio, ADR 0053). `requireUser` prueba la sesión; el id sale de ahí, nunca
 * del formulario, y `self_register_organization` vuelve a comprobar en Auth que el email esté confirmado. La contraseña se guarda antes
 * de crear nada: si el local falla, la cuenta sigue vacía y se reintenta.
 */
export async function createOwnLocalAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/crear-local");
  const rawName = formData.get("name");
  const rawSlug = formData.get("slug");
  const values = { name: typeof rawName === "string" ? rawName : "", slug: typeof rawSlug === "string" ? rawSlug : "" };
  const failed = (error: string): FormState => ({ error, values });

  const name = parseName(rawName);
  if (!name) return failed(SELF_REGISTER_MESSAGE.invalid_name);
  const slug = parseSlug(rawSlug);
  if (!slug) return failed(SELF_REGISTER_MESSAGE.invalid_slug);
  if (formData.get("terms") !== "on") return failed(SELF_REGISTER_MESSAGE.terms_required);

  const session = await createSessionClient();
  const { data: claims } = await session.auth.getClaims();
  const choosePassword = mustChoosePassword(authMethods(claims?.claims?.amr));

  let password: string | null = null;
  if (choosePassword) {
    const candidate = formData.get("password");
    const weak = typeof candidate === "string" ? validatePassword(candidate) : "blank";
    if (weak) return failed(PASSWORD_PROBLEM_MESSAGE[weak]);
    password = candidate as string;
  }

  const admin = createAdminClient();
  const taken = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (taken.error) return failed(SELF_REGISTER_MESSAGE.unexpected);
  if (taken.data) return failed(SELF_REGISTER_MESSAGE.slug_taken);

  if (password) {
    const updated = await session.auth.updateUser({ password });
    // Un reintento manda la misma contraseña: ya quedó guardada.
    if (updated.error && updated.error.code !== "same_password") {
      return failed(updated.error.code === "weak_password" ? PASSWORD_PROBLEM_MESSAGE.too_short : "No pudimos guardar la contraseña. Probá de nuevo en unos minutos.");
    }
    await session.auth.signOut({ scope: "others" });
  }

  const { error } = await admin.rpc("self_register_organization", {
    p_user: user.id,
    p_slug: slug,
    p_name: name,
    p_branch_slug: FIRST_BRANCH.slug,
    p_branch_name: FIRST_BRANCH.name,
    p_terms_version: TERMS_VERSION,
  });
  if (error) {
    const reason = selfRegisterErrorFrom(error);
    // Un reintento tras una respuesta perdida: el local ya está creado.
    if (reason === "already_owner") redirect("/panel");
    return failed(SELF_REGISTER_MESSAGE[reason]);
  }

  redirect(`/panel/${slug}`);
}
