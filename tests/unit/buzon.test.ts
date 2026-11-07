import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimMailboxIfProvisioned, MAILBOX_UNVERIFIED, MAILBOX_VERIFIED, mailboxState } from "@/lib/registro/buzon";

/** Cuentas creadas por un Dueño (ficha cuentas-creadas-por-duenos): la contraseña ajena se reemplaza al probar el correo. */

const adminMock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock.create }));

import { claimProvisionedMailbox } from "@/lib/registro/buzon-sesion";

type FakeAdmin = Parameters<typeof claimMailboxIfProvisioned>[0];

function fakeAdmin(results: Array<{ error: unknown }> = [{ error: null }, { error: null }]) {
  const updateUserById = vi.fn();
  results.forEach((r) => updateUserById.mockResolvedValueOnce(r));
  updateUserById.mockResolvedValue({ error: null });
  return { admin: { auth: { admin: { updateUserById } } } as unknown as FakeAdmin, updateUserById };
}

const unverified = { id: "u1", app_metadata: { mailbox: MAILBOX_UNVERIFIED } };

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
  it("pone una contraseña al azar, cierra las otras sesiones y recién después marca la cuenta como verificada", async () => {
    const orden: string[] = [];
    const updateUserById = vi.fn(async (_id: string, attrs: Record<string, unknown>) => {
      orden.push("password" in attrs ? "password" : "marca");
      return { error: null };
    });
    const admin = { auth: { admin: { updateUserById } } } as unknown as FakeAdmin;
    const revoke = vi.fn(async () => {
      orden.push("revoke");
    });

    expect(await claimMailboxIfProvisioned(admin, unverified, revoke)).toBe(true);

    expect(orden).toEqual(["password", "revoke", "marca"]);
    const [id, attrs] = updateUserById.mock.calls[0] as [string, { password: string }];
    expect(id).toBe("u1");
    expect(attrs.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(updateUserById.mock.calls[1][1]).toEqual({ app_metadata: { mailbox: MAILBOX_VERIFIED } });
  });

  it("no usa la misma contraseña dos veces", async () => {
    const { admin, updateUserById } = fakeAdmin([{ error: null }, { error: null }, { error: null }, { error: null }]);
    await claimMailboxIfProvisioned(admin, unverified, async () => {});
    await claimMailboxIfProvisioned(admin, { ...unverified, id: "u2" }, async () => {});
    const first = (updateUserById.mock.calls[0][1] as { password: string }).password;
    const second = (updateUserById.mock.calls[2][1] as { password: string }).password;
    expect(first).not.toBe(second);
  });

  it("no toca cuentas verificadas ni cuentas sin marca", async () => {
    const { admin, updateUserById } = fakeAdmin();
    const revoke = vi.fn();
    expect(await claimMailboxIfProvisioned(admin, { id: "u1", app_metadata: { mailbox: MAILBOX_VERIFIED } }, revoke)).toBe(false);
    expect(await claimMailboxIfProvisioned(admin, { id: "u2", app_metadata: { provider: "email" } }, revoke)).toBe(false);
    expect(await claimMailboxIfProvisioned(admin, { id: "u3" }, revoke)).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("falla cerrado si Auth no acepta cambiar la contraseña, y no cierra sesiones ni marca nada", async () => {
    const { admin, updateUserById } = fakeAdmin([{ error: { message: "boom" } }]);
    const revoke = vi.fn();
    await expect(claimMailboxIfProvisioned(admin, unverified, revoke)).rejects.toThrow("mailbox_claim_failed");
    expect(revoke).not.toHaveBeenCalled();
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });

  it("si no se pueden cerrar las otras sesiones, la cuenta queda sin verificar para reintentar", async () => {
    const { admin, updateUserById } = fakeAdmin();
    await expect(
      claimMailboxIfProvisioned(admin, unverified, async () => {
        throw new Error("revoke_failed");
      }),
    ).rejects.toThrow("revoke_failed");
    expect(updateUserById).toHaveBeenCalledTimes(1); // solo la contraseña; la marca no se tocó
  });
});

describe("claimProvisionedMailbox (sesión)", () => {
  const signOut = vi.fn();
  const session = { auth: { signOut } } as unknown as Parameters<typeof claimProvisionedMailbox>[0];

  beforeEach(() => {
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });
    adminMock.create.mockReset();
  });

  it("una cuenta común no pide la clave de servicio ni cierra sesiones", async () => {
    expect(await claimProvisionedMailbox(session, { id: "u1", app_metadata: { provider: "email" } })).toBe("none");
    expect(adminMock.create).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("una cuenta creada por un Dueño: reemplaza la contraseña y cierra las demás sesiones", async () => {
    const { admin, updateUserById } = fakeAdmin();
    adminMock.create.mockReturnValue(admin);
    expect(await claimProvisionedMailbox(session, unverified)).toBe("claimed");
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(updateUserById).toHaveBeenCalledTimes(2);
  });

  it("si falla el cierre de las otras sesiones, corta esta sesión y la cuenta sigue sin verificar", async () => {
    const { admin, updateUserById } = fakeAdmin();
    adminMock.create.mockReturnValue(admin);
    signOut.mockResolvedValueOnce({ error: { message: "fail" } });
    expect(await claimProvisionedMailbox(session, unverified)).toBe("failed");
    expect(signOut).toHaveBeenLastCalledWith();
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });

  it("si falta la clave de servicio, falla cerrado", async () => {
    adminMock.create.mockImplementation(() => {
      throw new Error("sin clave");
    });
    expect(await claimProvisionedMailbox(session, unverified)).toBe("failed");
    expect(signOut).toHaveBeenCalledWith();
  });
});
