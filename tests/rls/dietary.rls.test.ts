import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateProduct } from "@/lib/carta/catalog";
import { updateGroup, updateOption } from "@/lib/carta/options";
import { loadRows } from "@/lib/public-menu";
import { addMembership, anonClient, createCategory, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, serviceClient, setSubscription, type TestUser } from "./helpers";

const service = serviceClient();
let owner: TestUser, staff: TestUser, stranger: TestUser;
let org: string, category: string, product: string;

beforeAll(async () => {
  [owner, staff, stranger] = await Promise.all([createUser(service, "diet-owner"), createUser(service, "diet-staff"), createUser(service, "diet-ajeno")]);
  org = await createOrg(service, "tt-dietary");
  await addMembership(service, owner, org, "owner");
  await addMembership(service, staff, org, "staff");
  category = await createCategory(service, org);
  const p = await service.from("products").insert({ organization_id: org, category_id: category, name: "Té de prueba", price_cents: 100 }).select("id").single();
  if (p.error) throw p.error;
  product = p.data.id;
});
afterAll(async () => {
  await deleteOrg(service, org);
  await Promise.all([owner, staff, stranger].map((user) => deleteUser(service, user)));
});

describe("declaraciones dietarias con los permisos de catálogo", () => {
  it("Dueño y Staff guardan y quitan etiquetas desde el módulo; anon las lee en la carta", async () => {
    for (const user of [owner, staff]) {
      expect(await updateProduct(user.db, org, product, { categoryId: category, name: "Té de prueba", description: "", price: "1", dietaryTags: ["vegan", "gluten_free"] })).toEqual({ ok: true, data: undefined });
      expect((await loadRows(org)).products.find((p) => p.id === product)?.dietary_tags).toEqual(["gluten_free", "vegan"]);
    }
    expect(await updateProduct(owner.db, org, product, { categoryId: category, name: "Té de prueba", description: "", price: "1", dietaryTags: [] })).toMatchObject({ ok: true });
    expect((await loadRows(org)).products[0].dietary_tags).toEqual([]);
  });
  it("la base rechaza desconocidas, nulos y arreglos inválidos sin depender del formulario", async () => {
    for (const tags of [["unknown"], [null], null, [["vegan"]], Array(4).fill("vegan")]) {
      // Cuerpo HTTP deliberadamente mal formado: comprueba el contrato SQL, no el tipo TS.
      const result = await owner.db.from("products").update({ dietary_tags: tags as string[] }).eq("id", product);
      expect(result.error, JSON.stringify(tags)).not.toBeNull();
    }
    const invalid = await updateProduct(owner.db, org, product, { categoryId: category, name: "Té", description: "", price: "1", dietaryTags: ["unknown"] });
    expect(invalid).toEqual({ ok: false, error: "dietary_invalid" });
  });
  it("anónimo y usuario ajeno no alteran el plato", async () => {
    for (const db of [anonClient(), stranger.db]) {
      const result = await db.from("products").update({ dietary_tags: ["vegan"] }).eq("id", product).select("id");
      expect(result.error !== null || result.data?.length === 0).toBe(true);
    }
    expect((await service.from("products").select("dietary_tags").eq("id", product).single()).data?.dietary_tags).toEqual([]);
  });
  it("solo lectura y suspensión bloquean ambos roles; gracia permite", async () => {
    for (const days of [10, 20]) {
      await setSubscription(service, org, { finEnMs: -days * DIA_MS });
      for (const user of [owner, staff]) {
        const result = await user.db.from("products").update({ dietary_tags: ["vegan"] }).eq("id", product).select("id");
        expect(result.error !== null || result.data?.length === 0).toBe(true);
      }
      expect((await service.from("products").select("dietary_tags").eq("id", product).single()).data?.dietary_tags).toEqual([]);
      expect((await loadRows(org)).products).toHaveLength(days === 20 ? 0 : 1);
    }
    await setSubscription(service, org, { finEnMs: -3 * DIA_MS });
    expect((await staff.db.from("products").update({ dietary_tags: ["vegan"] }).eq("id", product).select("id")).data).toHaveLength(1);
  });
  it("las etiquetas no publican un plato ni una categoría inactivos", async () => {
    await service.from("products").update({ is_active: false }).eq("id", product);
    expect((await loadRows(org)).products).toEqual([]);
    await service.from("products").update({ is_active: true }).eq("id", product);
    await service.from("categories").update({ is_active: false }).eq("id", category);
    expect((await loadRows(org)).products).toEqual([]);
  });
});

describe("la información alimentaria no queda desactualizada en otros idiomas", () => {
  const translate = { en: { name: "Tea", description: "With milk." }, pt: { description: "Com leite." } };
  const stored = async (table: "products" | "option_groups" | "options", id: string) =>
    (await service.from(table).select("translations").eq("id", id).single()).data?.translations;

  it("cambiar el nombre o la descripción de un plato quita esa traducción en todos los idiomas; guardar igual la conserva", async () => {
    await service.from("categories").update({ is_active: true }).eq("id", category); // el caso anterior la dejó inactiva
    await service.from("products").update({ description: "Con leche.", translations: translate }).eq("id", product);
    const same = { categoryId: category, name: "Té de prueba", description: "Con leche.", price: "1" };

    expect((await updateProduct(owner.db, org, product, same)).ok).toBe(true);
    expect(await stored("products", product)).toEqual(translate);

    expect((await updateProduct(owner.db, org, product, { ...same, description: "Con leche y maní." })).ok).toBe(true);
    expect(await stored("products", product)).toEqual({ en: { name: "Tea" } });
    expect((await loadRows(org)).products.find((p) => p.id === product)?.translations).toEqual({ en: { name: "Tea" } });

    expect((await updateProduct(owner.db, org, product, { ...same, name: "Té negro", description: "Con leche y maní." })).ok).toBe(true);
    expect(await stored("products", product)).toEqual({});
  });

  it("lo mismo vale para variantes y adicionales", async () => {
    const group = await service.from("option_groups").insert({ organization_id: org, product_id: product, name: "Leche", min_choices: 1, max_choices: 1, sort_order: 0, translations: { en: { name: "Milk" } } }).select("id").single();
    if (group.error) throw group.error;
    const option = await service.from("options").insert({ organization_id: org, group_id: group.data.id, name: "De almendras", price_delta_cents: 0, sort_order: 0, translations: { en: { name: "Almond" } } }).select("id").single();
    if (option.error) throw option.error;

    expect((await updateGroup(owner.db, org, group.data.id, { name: "Leche", min: "1", max: "1" })).ok).toBe(true);
    expect((await updateOption(owner.db, org, option.data.id, { name: "De almendras", delta: "0" })).ok).toBe(true);
    expect(await stored("option_groups", group.data.id)).toEqual({ en: { name: "Milk" } });
    expect(await stored("options", option.data.id)).toEqual({ en: { name: "Almond" } });

    expect((await updateGroup(owner.db, org, group.data.id, { name: "Tipo de leche", min: "1", max: "1" })).ok).toBe(true);
    expect((await updateOption(owner.db, org, option.data.id, { name: "De avena", delta: "0" })).ok).toBe(true);
    expect(await stored("option_groups", group.data.id)).toEqual({});
    expect(await stored("options", option.data.id)).toEqual({});
  });
});
