import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimMailboxIfProvisioned, MAILBOX_UNVERIFIED, MAILBOX_VERIFIED, mailboxState } from "@/lib/registro/buzon";

/** Cuentas creadas por un Dueño (ficha cuentas-creadas-por-duenos): la contraseña ajena se reemplaza al probar el correo. */

const adminMock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock.create }));

import { claimProvisionedMailbox } from "@/lib/registro/buzon-sesion";

type FakeAdmin = Parameters<typeof claimMailboxIfProvisioned>[0];

function fakeAdmin(opts: { updates?: Array<{ error: unknown }>; link?: unknown } = {}) {
  const updateUserById = vi.fn();
  (opts.updates ?? []).forEach((r) => updateUserById.mockResolvedValueOnce(r));
  updateUserById.mockResolvedValue({ error: null });
  const generateLink = vi.fn().mockResolvedValue(opts.link ?? { data: { properties: { hashed_token: "hash-nuevo" } }, error: null });
  return { admin: { auth: { admin: { updateUserById, generateLink } } } as unknown as FakeAdmin, updateUserById, generateLink };
}

const unverified = { id: "u1", email: "persona@example.test", app_metadata: { mailbox: MAILBOX_UNVERIFIED } };

describe("mailboxState", () => {
  it("lee la marca solo si es un texto dentro de un objeto", () => {
    expect(mailboxState({ mailbox: "unverified" })).toBe("unverified");
    expect(mailboxState({ mailbox: "verified" })).toBe("verified");
    expect(mailboxState({ mailbox: 1 })).toBeNull();
    expect(mailboxState({})).toBeNull();
    expect(mailboxState(null)).toBeNull();
    expect(mailboxState("unverified")).toBeNull();
    expect(mailboxState(undefined)).toBeNull();
  });
});

describe("claimMailboxIfProvisioned", () => {
  it("pone una contraseña al azar y recién después marca la cuenta como verificada", async () => {
    const orden: string[] = [];
    const updateUserById = vi.fn(async (_id: string, attrs: Record<string, unknown>) => {
      orden.push("password" in attrs ? "password" : "marca");
      return { error: null };
    });
    const admin = { auth: { admin: { updateUserById } } } as unknown as FakeAdmin;

    expect(await claimMailboxIfProvisioned(admin, unverified)).toBe(true);

    expect(orden).toEqual(["password", "marca"]);
    const [id, attrs] = updateUserById.mock.calls[0] as [string, { password: string }];
    expect(id).toBe("u1");
    expect(attrs.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(updateUserById.mock.calls[1][1]).toEqual({ app_metadata: { mailbox: MAILBOX_VERIFIED } });
  });

  it("no usa la misma contraseña dos veces", async () => {
    const { admin, updateUserById } = fakeAdmin();
    await claimMailboxIfProvisioned(admin, unverified);
    await claimMailboxIfProvisioned(admin, { ...unverified, id: "u2" });
    const first = (updateUserById.mock.calls[0][1] as { password: string }).password;
    const second = (updateUserById.mock.calls[2][1] as { password: string }).password;
    expect(first).not.toBe(second);
  });

  it("no toca cuentas verificadas ni cuentas sin marca", async () => {
    const { admin, updateUserById } = fakeAdmin();
    expect(await claimMailboxIfProvisioned(admin, { id: "u1", app_metadata: { mailbox: MAILBOX_VERIFIED } })).toBe(false);
    expect(await claimMailboxIfProvisioned(admin, { id: "u2", app_metadata: { provider: "email" } })).toBe(false);
    expect(await claimMailboxIfProvisioned(admin, { id: "u3" })).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("falla cerrado si Auth no acepta cambiar la contraseña, y no marca nada", async () => {
    const { admin, updateUserById } = fakeAdmin({ updates: [{ error: { message: "boom" } }] });
    await expect(claimMailboxIfProvisioned(admin, unverified)).rejects.toThrow("mailbox_claim_failed");
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });

  it("si no puede poner la marca, falla y la cuenta queda sin verificar para reintentar", async () => {
    const { admin } = fakeAdmin({ updates: [{ error: null }, { error: { message: "boom" } }] });
    await expect(claimMailboxIfProvisioned(admin, unverified)).rejects.toThrow("mailbox_claim_failed");
  });
});

describe("claimProvisionedMailbox (sesión)", () => {
  const signOut = vi.fn();
  const verifyOtp = vi.fn();
  const session = { auth: { signOut, verifyOtp } } as unknown as Parameters<typeof claimProvisionedMailbox>[0];

  beforeEach(() => {
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ error: null });
    adminMock.create.mockReset();
  });

  it("una cuenta común no pide la clave de servicio ni toca la sesión", async () => {
    expect(await claimProvisionedMailbox(session, { id: "u1", email: "a@example.test", app_metadata: { provider: "email" } })).toBe("none");
    expect(adminMock.create).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("una cuenta creada por un Dueño: reemplaza la contraseña y abre una sesión nueva para la persona", async () => {
    const { admin, updateUserById, generateLink } = fakeAdmin();
    adminMock.create.mockReturnValue(admin);

    expect(await claimProvisionedMailbox(session, unverified)).toBe("claimed");

    expect(updateUserById).toHaveBeenCalledTimes(2);
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "persona@example.test" });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-nuevo", type: "email" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("si no se puede abrir la sesión nueva, corta la sesión y devuelve failed", async () => {
    const { admin } = fakeAdmin();
    adminMock.create.mockReturnValue(admin);
    verifyOtp.mockResolvedValueOnce({ error: { message: "fail" } });
    expect(await claimProvisionedMailbox(session, unverified)).toBe("failed");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("si Auth no genera el enlace, falla cerrado", async () => {
    const { admin } = fakeAdmin({ link: { data: { properties: {} }, error: null } });
    adminMock.create.mockReturnValue(admin);
    expect(await claimProvisionedMailbox(session, unverified)).toBe("failed");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("si falta la clave de servicio o el email, falla cerrado", async () => {
    adminMock.create.mockImplementation(() => {
      throw new Error("sin clave");
    });
    expect(await claimProvisionedMailbox(session, unverified)).toBe("failed");
    expect(await claimProvisionedMailbox(session, { id: "u1", app_metadata: { mailbox: MAILBOX_UNVERIFIED } })).toBe("failed");
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
