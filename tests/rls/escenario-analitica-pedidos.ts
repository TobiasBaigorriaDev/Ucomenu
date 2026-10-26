import { randomUUID } from "node:crypto";
import { sql } from "./helpers";

/**
 * Escenario común de la analítica de pedidos (ficha analitica-de-pedidos) para las pruebas de base y de navegador: pedidos
 * sembrados como dueño de las tablas (la API no escribe `orders`), con horas relativas a la hora local de cada sucursal, así que
 * los números no dependen de cuándo se corra la prueba.
 */

export const BA = "America/Argentina/Buenos_Aires";
export const MAD = "Europe/Madrid";

const q = (texto: string) => `'${texto.replace(/'/g, "''")}'`;

/** Un instante en la hora local de `tz`: hoy menos `dias` días, a las `hhmm`. Se calcula en la base. */
export const loc = (tz: string, dias: number, hhmm: string) => `((((now() at time zone '${tz}')::date - ${dias}) + time '${hhmm}') at time zone '${tz}')`;

export type Linea = { producto: string | null; nombre: string; qty: number; base: number; unit?: number; opciones?: number; estado?: string; motivo?: string };
export type Pedido = { branch: string; estado: "open" | "closed" | "void"; abre: string; cierra?: string; motivo?: string; lineas: Linea[] };

/** Siembra un pedido (terminado o abierto) con sus líneas, en una sola transacción. */
export function sembrarPedido(orgId: string, p: Pedido): string {
  const id = randomUUID();
  const lineas = p.lineas
    .map(
      (l) =>
        `insert into public.order_items (organization_id, order_id, product_id, product_name, quantity, base_price_cents, unit_price_cents, options_cents, status, cancel_reason, client_key, request_hash) values ` +
        `('${orgId}', '${id}', ${l.producto ? `'${l.producto}'` : "null"}, ${q(l.nombre)}, ${l.qty}, ${l.base}, ${l.unit ?? l.base}, ${l.opciones ?? 0}, '${l.estado ?? "delivered"}', ${l.motivo ? q(l.motivo) : "null"}, gen_random_uuid(), 'x');`,
    )
    .join("");
  sql(
    `insert into public.orders (id, organization_id, branch_id, table_label, status, opened_at, closed_at, void_reason) values ` +
      `('${id}', '${orgId}', '${p.branch}', 'Mesa 1', '${p.estado}', ${p.abre}, ${p.cierra ?? "null"}, ${p.motivo ? q(p.motivo) : "null"});${lineas}`,
  );
  return id;
}

export function sembrarVistas(orgId: string, producto: string, branch: string, views: number) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: BA }).format(new Date());
  sql(
    `insert into public.dish_view_counts (organization_id, branch_id, product_id, day, views) values ('${orgId}', '${branch}', '${producto}', '${hoy}', ${views}) ` +
      `on conflict (branch_id, product_id, day) do update set views = excluded.views`,
  );
}

/** Día de la semana ISO (1 = lunes) de «hoy menos `dias`» en la zona `tz`. */
export function isoDow(tz: string, dias: number): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()).split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d - dias)).getUTCDay();
  return dia === 0 ? 7 : dia;
}

export type LocalAnalitica = {
  orgId: string;
  /** Sucursal en hora de Buenos Aires. */
  uno: string;
  /** Sucursal en hora de Madrid (el escenario la fija). */
  dos: string;
  /** Platos por nombre: Milanesa, Ensalada, Flan, Sopa, Tarta, Oculto. */
  producto: Record<string, string>;
};

/**
 * Cuatro pedidos cerrados en el período (49.000 centavos), un anulado, uno abierto, uno cerrado sin líneas vivas y dos viejos
 * (hace 40 y 100 días); vistas de cuatro platos y un plato oculto en la sucursal «uno». Los números esperados están en
 * `analitica-pedidos.rls.test.ts`.
 */
export function sembrarEscenario(l: LocalAnalitica) {
  const p = l.producto;
  const s = (pedido: Pedido) => sembrarPedido(l.orgId, pedido);
  // 1 · ayer 13:10–13:40 en Buenos Aires: 22.000 (con opciones) + 4.000 (promo) = 26.000; Flan cancelado no suma.
  s({
    branch: l.uno,
    estado: "closed",
    abre: loc(BA, 1, "13:10"),
    cierra: loc(BA, 1, "13:40"),
    lineas: [
      { producto: p.Milanesa, nombre: "Milanesa", qty: 2, base: 10000, opciones: 1000 },
      { producto: p.Ensalada, nombre: "Ensalada", qty: 1, base: 5000, unit: 4000 },
      { producto: p.Flan, nombre: "Flan", qty: 3, base: 3000, estado: "cancelled", motivo: "Se equivocó" },
    ],
  });
  // 2 · hace 3 días 20:00–21:00: 13.000.
  s({
    branch: l.uno,
    estado: "closed",
    abre: loc(BA, 3, "20:00"),
    cierra: loc(BA, 3, "21:00"),
    lineas: [
      { producto: p.Milanesa, nombre: "Milanesa", qty: 1, base: 10000 },
      { producto: p.Flan, nombre: "Flan", qty: 1, base: 3000 },
    ],
  });
  // 3 · sucursal de Madrid: abre anteayer 23:00 y cierra ayer 00:30, hora de Madrid: 5.000.
  s({
    branch: l.dos,
    estado: "closed",
    abre: loc(MAD, 2, "23:00"),
    cierra: loc(MAD, 1, "00:30"),
    lineas: [{ producto: p.Ensalada, nombre: "Ensalada", qty: 1, base: 5000 }],
  });
  // 3b · Madrid otra vez: ayer 22:30–23:30, hora de Madrid: 5.000. Con el anterior, un error de zona (leer Madrid con la hora de
  // Buenos Aires) corre el día de al menos uno de los dos a cualquier hora en que se corra la prueba.
  s({
    branch: l.dos,
    estado: "closed",
    abre: loc(MAD, 1, "22:30"),
    cierra: loc(MAD, 1, "23:30"),
    lineas: [{ producto: p.Ensalada, nombre: "Ensalada", qty: 1, base: 5000 }],
  });
  // 4 · anulado (hace 2 días): lo que tenía anotado, 10.000, no suma a las ventas.
  s({
    branch: l.uno,
    estado: "void",
    abre: loc(BA, 2, "19:00"),
    cierra: loc(BA, 2, "19:20"),
    motivo: "Cliente se fue",
    lineas: [{ producto: p.Milanesa, nombre: "Milanesa", qty: 1, base: 10000 }],
  });
  // 5 · abierto: no cuenta.
  s({ branch: l.uno, estado: "open", abre: loc(BA, 0, "00:00"), lineas: [{ producto: p.Milanesa, nombre: "Milanesa", qty: 5, base: 10000 }] });
  // 6 · hace 40 días (período anterior de 30; dentro de los 90): 6.000.
  s({
    branch: l.uno,
    estado: "closed",
    abre: loc(BA, 40, "11:30"),
    cierra: loc(BA, 40, "12:00"),
    lineas: [{ producto: p.Flan, nombre: "Flan", qty: 2, base: 3000 }],
  });
  // 7 · hace 100 días (fuera de 30; período anterior de 90): 10.000.
  s({
    branch: l.uno,
    estado: "closed",
    abre: loc(BA, 100, "11:30"),
    cierra: loc(BA, 100, "12:00"),
    lineas: [{ producto: p.Milanesa, nombre: "Milanesa", qty: 1, base: 10000 }],
  });
  // 8 · cerrado con todo cancelado (hace 2 días): no es una venta, pero su cancelación se cuenta (con otra mayúscula en el motivo).
  s({
    branch: l.uno,
    estado: "closed",
    abre: loc(BA, 2, "10:00"),
    cierra: loc(BA, 2, "10:10"),
    lineas: [{ producto: p.Flan, nombre: "Flan", qty: 1, base: 3000, estado: "cancelled", motivo: "se equivocó" }],
  });
  sembrarVistas(l.orgId, p.Milanesa, l.uno, 50);
  sembrarVistas(l.orgId, p.Ensalada, l.dos, 10);
  sembrarVistas(l.orgId, p.Sopa, l.uno, 20);
  sembrarVistas(l.orgId, p.Tarta, l.dos, 5);
  sql(`insert into public.product_availability (organization_id, branch_id, product_id, is_visible) values ('${l.orgId}', '${l.uno}', '${p.Oculto}', false)`);
}
