import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "./helpers";

/**
 * Migración 20261216100000 (precios en pesos, ficha precios-en-pesos). Se ejecuta DENTRO de transacciones que se deshacen, desde el
 * estado anterior (el que deja su rollback documentado), sobre la base local: no cambia nada de forma permanente.
 * La guarda existe para que el rollback documentado (precios USD fijos) sea siempre fiel: si los precios de partida no son los del
 * seed, la migración se detiene sin cambiar nada.
 */
const migracion = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/20261216100000_precios_en_pesos.sql"), "utf8");
const cuerpo = migracion
  .split("\n")
  .filter((linea) => !["begin;", "commit;"].includes(linea.trim()))
  .join("\n");

/** El rollback del encabezado de la migración, más el nombre viejo de los dos `check`. */
const ROLLBACK = `
alter table public.plans drop constraint plans_prices_together_check;
update public.plans set monthly_price_cents = case code when 'basic' then 2000 when 'pro' then 4000 else 7000 end,
                        yearly_price_cents  = case code when 'basic' then 19000 when 'pro' then 38000 else 67000 end;
alter table public.plans alter column monthly_price_cents set not null, alter column yearly_price_cents set not null;
alter table public.plans drop column price_currency;
alter table public.plans rename column monthly_price_cents to monthly_price_usd_cents;
alter table public.plans rename column yearly_price_cents to yearly_price_usd_cents;
alter table public.plans rename constraint plans_monthly_price_cents_check to plans_monthly_price_usd_cents_check;
alter table public.plans rename constraint plans_yearly_price_cents_check to plans_yearly_price_usd_cents_check;
`;

const PRECIOS_HOY = "select code, monthly_price_cents, yearly_price_cents, price_currency from public.plans order by code";
const sinGuarda = cuerpo.replace(/do \$\$[\s\S]*?\n\$\$;/, "");

function enTransaccion(...partes: string[]): string[][] {
  return sql(`begin; ${partes.join("\n")}\nrollback;`);
}

describe("migración a pesos: guarda de los precios de partida", () => {
  it("el cuerpo extraído tiene la guarda y el bloqueo (si no, esta prueba no prueba nada)", () => {
    expect(cuerpo).toContain("plans_prices_unexpected");
    expect(cuerpo).toContain("lock table public.plans in access exclusive mode");
    expect(sinGuarda).not.toContain("plans_prices_unexpected");
  });

  it("rollback documentado + migración vuelve a dar los precios en pesos", () => {
    const filas = enTransaccion(ROLLBACK, cuerpo, PRECIOS_HOY + ";");
    expect(filas).toContainEqual(["basic", "1490000", "14304000", "ARS"]);
    expect(filas).toContainEqual(["pro", "2900000", "27840000", "ARS"]);
    expect(filas).toContainEqual(["premium", "", "", "ARS"]);
  });

  it("con un precio de partida distinto la migración se detiene y no cambia nada", () => {
    expect(() => enTransaccion(ROLLBACK, "update public.plans set monthly_price_usd_cents = 4100 where code = 'pro';", cuerpo)).toThrow(/plans_prices_unexpected/);
    expect(sql(PRECIOS_HOY)).toContainEqual(["pro", "2900000", "27840000", "ARS"]);
  });

  it("sin la guarda esa misma migración pisaría el precio editado (la prueba de arriba discrimina)", () => {
    const filas = enTransaccion(ROLLBACK, "update public.plans set monthly_price_usd_cents = 4100 where code = 'pro';", sinGuarda, PRECIOS_HOY + ";");
    expect(filas).toContainEqual(["pro", "2900000", "27840000", "ARS"]);
  });

  it("la base local sigue con los precios en pesos después de las pruebas", () => {
    expect(sql(PRECIOS_HOY)).toEqual([
      ["basic", "1490000", "14304000", "ARS"],
      ["premium", "", "", "ARS"],
      ["pro", "2900000", "27840000", "ARS"],
    ]);
  });
});
