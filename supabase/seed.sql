-- Datos semilla FICTICIOS para desarrollo y pruebas. Nunca datos reales de clientes.
-- Las pruebas de RLS y E2E dependen de estos datos: si los cambiás, actualizá las pruebas.
-- Precios en centavos de ARS.

-- Organización 1: carta completa, con filas inactivas para probar que no se publican.
insert into public.organizations (id, slug, name) values
  ('10000000-0000-4000-8000-000000000001', 'cafe-ejemplo', 'Café Ejemplo');

insert into public.branches (id, organization_id, slug, name) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'centro', 'Centro');

insert into public.categories (id, organization_id, name, sort_order, is_active) values
  ('12000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Cafetería',  1, true),
  ('12000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Pastelería', 2, true),
  -- Categoría inactiva: ni ella ni sus platos deben aparecer.
  ('12000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Temporada',  3, false);

insert into public.products (id, organization_id, category_id, name, description, price_cents, sort_order, is_active) values
  ('13000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001',
   'Espresso', 'Blend de la casa, tostado medio. Doble por defecto.', 280000, 1, true),
  ('13000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001',
   'Flat white', 'Doble espresso con leche texturizada, servido en taza chica para que el café se note.', 420000, 2, true),
  -- Plato inactivo en categoría activa: no debe aparecer.
  ('13000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001',
   'Cold brew (discontinuado)', 'No debe verse en la carta pública.', 390000, 3, false),
  ('13000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002',
   'Medialuna de manteca', null, 150000, 1, true),
  -- Plato activo dentro de una categoría inactiva: no debe aparecer.
  ('13000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000003',
   'Helado de maracuyá (categoría inactiva)', 'No debe verse en la carta pública.', 360000, 1, true);

-- Organización 2: existe para probar el aislamiento entre tenants.
insert into public.organizations (id, slug, name) values
  ('20000000-0000-4000-8000-000000000001', 'parrilla-demo', 'Parrilla Demo');

insert into public.branches (id, organization_id, slug, name) values
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'sur', 'Sur');

insert into public.categories (id, organization_id, name, sort_order, is_active) values
  ('22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Parrilla', 1, true);

insert into public.products (id, organization_id, category_id, name, description, price_cents, sort_order, is_active) values
  ('23000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'Entraña', 'Cocción a punto, con papas rústicas.', 1250000, 1, true),
  ('23000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'Provoleta', null, 680000, 2, true);

-- Organización 3: suspendida (is_active = false). Nada de lo que cuelga de ella debe publicarse.
insert into public.organizations (id, slug, name, is_active) values
  ('30000000-0000-4000-8000-000000000001', 'bar-inactivo', 'Bar Inactivo', false);

insert into public.branches (id, organization_id, slug, name) values
  ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'unica', 'Única');

insert into public.categories (id, organization_id, name, sort_order) values
  ('32000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Tragos', 1);

insert into public.products (id, organization_id, category_id, name, price_cents) values
  ('33000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001',
   'Fernet con cola', 450000);
