-- Datos semilla FICTICIOS para desarrollo y pruebas. Nunca datos reales de clientes.
-- Las pruebas de RLS y E2E dependen de estos datos: si los cambiás, actualizá las pruebas.
-- Precios en centavos de ARS.

-- Organización 1: carta completa, con filas inactivas para probar que no se publican.
-- slug_aliases inicia vacío; los escenarios de corrección generan sus propios históricos.
insert into public.organizations (id, slug, name, menu_palette) values
  ('10000000-0000-4000-8000-000000000001', 'cafe-ejemplo', 'Café Ejemplo', 'oliva');

-- Las sucursales de ejemplo heredan el reinicio diario de QR a las 05:00, en su zona horaria.
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

-- Variantes y adicionales de ejemplo (ficha variantes-y-adicionales). Ids con el prefijo 14 (grupos) y 15 (opciones).
--   Espresso:  «Tamaño» (variante 1/1: Simple +$ 0, Doble +$ 600, y «Triple (agotado)» inactiva) y «Extras» (0/3: Leche de
--              almendras +$ 300, Crema +$ 200); «Grupo oculto» inactivo (no debe publicarse).
--   Plato inactivo (Cold brew): un grupo activo que NO debe publicarse porque el plato no se ve.
insert into public.option_groups (id, organization_id, product_id, name, min_choices, max_choices, sort_order, is_active) values
  ('14000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'Tamaño', 1, 1, 0, true),
  ('14000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'Extras', 0, 3, 1, true),
  ('14000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'Grupo oculto', 0, 1, 2, false),
  ('14000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000003', 'Tamaño de plato inactivo', 1, 1, 0, true);

insert into public.options (id, organization_id, group_id, name, price_delta_cents, sort_order, is_active) values
  ('15000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 'Simple', 0, 0, true),
  ('15000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 'Doble', 60000, 1, true),
  ('15000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 'Triple (agotado)', 120000, 2, false),
  ('15000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 'Leche de almendras', 30000, 0, true),
  ('15000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 'Crema', 20000, 1, true),
  ('15000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000003', 'Opción de grupo oculto', 10000, 0, true),
  ('15000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000004', 'Opción de plato inactivo', 10000, 0, true);

-- Declaraciones dietarias de ejemplo (datos ficticios, no certificaciones).
update public.products set dietary_tags = array['gluten_free']
where id = '13000000-0000-4000-8000-000000000001';
update public.products set dietary_tags = array['vegetarian']
where id = '13000000-0000-4000-8000-000000000004';

-- Organización 2: existe para probar el aislamiento entre tenants.
insert into public.organizations (id, slug, name, menu_palette) values
  ('20000000-0000-4000-8000-000000000001', 'parrilla-demo', 'Parrilla Demo', 'cacao');

insert into public.branches (id, organization_id, slug, name) values
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'sur', 'Sur');

insert into public.categories (id, organization_id, name, sort_order, is_active) values
  ('22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Parrilla', 1, true);

insert into public.products (id, organization_id, category_id, name, description, price_cents, sort_order, is_active) values
  ('23000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'Entraña', 'Cocción a punto, con papas rústicas.', 1250000, 1, true),
  ('23000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'Provoleta', null, 680000, 2, true);

insert into public.option_groups (id, organization_id, product_id, name, min_choices, max_choices, sort_order, is_active) values
  ('24000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', 'Punto de cocción', 1, 1, 0, true);

insert into public.options (id, organization_id, group_id, name, price_delta_cents, sort_order, is_active) values
  ('25000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', 'A punto', 0, 0, true),
  ('25000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', 'Bien cocida', 0, 1, true);

-- Estado explícito de ejemplo: disponible. Los platos sin fila también están disponibles.
insert into public.product_availability (organization_id, branch_id, product_id, is_available) values
  ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', true);

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

-- Organización 4: con la cuenta vencida hace más de 15 días (suspendida). Su carta no se publica.
-- Toda organización nueva recibe una prueba de 14 días (trigger); acá se vence a propósito.
-- Las organizaciones 1 a 3 quedan con la prueba vigente (se dan de alta al correr el seed).
insert into public.organizations (id, slug, name) values
  ('40000000-0000-4000-8000-000000000001', 'resto-moroso', 'Resto Moroso');

update public.subscriptions
set trial_ends_at = now() - interval '40 days'
where organization_id = '40000000-0000-4000-8000-000000000001';

insert into public.branches (id, organization_id, slug, name) values
  ('41000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'unica', 'Única');

insert into public.categories (id, organization_id, name, sort_order) values
  ('42000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Minutas', 1);

insert into public.products (id, organization_id, category_id, name, price_cents) values
  ('43000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
   'Milanesa completa', 980000);

-- Mesas de ejemplo con tokens FIJOS (solo desarrollo y pruebas: en la app el token lo genera siempre la base).
-- Las pruebas de /t/{token} dependen de estos valores.
--   Café Ejemplo:  Mesa 1 y Mesa 2 activas; «Mesa 3 (fuera de servicio)» inactiva
--   Parrilla Demo: Mesa 1 activa · Bar Inactivo (organización inactiva) · Resto Moroso (cuenta suspendida)
insert into public.tables (id, organization_id, branch_id, label, qr_token, is_active) values
  ('14000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001',
   'Mesa 1', 'c0ffee01000000000000000000000000', true),
  ('14000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001',
   'Mesa 2', 'c0ffee02000000000000000000000000', true),
  ('14000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001',
   'Mesa 3 (fuera de servicio)', 'c0ffee03000000000000000000000000', false),
  ('24000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001',
   'Mesa 1', 'fa11a001000000000000000000000000', true),
  ('34000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
   'Mesa 1', 'bad00001000000000000000000000000', true),
  ('44000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
   'Mesa 1', 'dead0001000000000000000000000000', true);

-- ---------------------------------------------------------------------------
-- Usuarios de ejemplo (SOLO DESARROLLO Y PRUEBAS). Contraseña pública: ucomenu-dev-2026.
-- Nunca se cargan en producción: el seed solo corre con `supabase db reset` local.
-- Las pruebas E2E y de base dependen de estos usuarios.
--   dueno@cafe-ejemplo.test / mozo@cafe-ejemplo.test         → Café Ejemplo (owner / staff)
--   dueno@parrilla-demo.test / mozo@parrilla-demo.test       → Parrilla Demo
--   dueno@resto-moroso.test / mozo@resto-moroso.test         → Resto Moroso (cuenta vencida)
--   multi@ucomenu.test                                       → owner en Café Ejemplo y staff en Parrilla Demo
--   admin@ucomenu.test                                       → SuperAdmin de la plataforma (/admin), sin ninguna organización
-- ---------------------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('a0000000-0000-4000-8000-000000000001'::uuid, 'dueno@cafe-ejemplo.test'),
      ('a0000000-0000-4000-8000-000000000002'::uuid, 'mozo@cafe-ejemplo.test'),
      ('a0000000-0000-4000-8000-000000000003'::uuid, 'dueno@parrilla-demo.test'),
      ('a0000000-0000-4000-8000-000000000004'::uuid, 'mozo@parrilla-demo.test'),
      ('a0000000-0000-4000-8000-000000000005'::uuid, 'dueno@resto-moroso.test'),
      ('a0000000-0000-4000-8000-000000000006'::uuid, 'mozo@resto-moroso.test'),
      ('a0000000-0000-4000-8000-000000000007'::uuid, 'multi@ucomenu.test'),
      ('a0000000-0000-4000-8000-000000000008'::uuid, 'admin@ucomenu.test')
    ) as t(id, email)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('ucomenu-dev-2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
    values (
      gen_random_uuid(), u.id, u.id::text, 'email',
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      now(), now(), now()
    );
  end loop;
end;
$$;

insert into public.memberships (user_id, organization_id, role) values
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('a0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'staff'),
  ('a0000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'owner'),
  ('a0000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'staff'),
  ('a0000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000001', 'owner'),
  ('a0000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000001', 'staff'),
  ('a0000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('a0000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', 'staff');

-- SuperAdmin de ejemplo (solo desarrollo y pruebas). En un entorno real lo agrega el operador con SQL (ficha superadmin-alta-de-organizaciones).
insert into public.platform_admins (user_id) values ('a0000000-0000-4000-8000-000000000008');

-- ---------------------------------------------------------------------------
-- Historial de precios de ejemplo (ficha historial-de-precios). Se inserta directo: el seed corre como dueño de
-- la tabla y no hay usuario en la sesión, así que el trigger no sabría atribuirlo. Cada último precio coincide con el
-- precio actual del plato. Un cambio sin usuario (changed_by null) representa una operación técnica.
--   Café Ejemplo:  Espresso 2.600 -> 2.700 (Staff) -> 2.800 (Dueño) · Flat white 4.000 -> 4.200 (técnica)
--   Parrilla Demo: Entraña 12.000 -> 12.500 (Staff)
-- ---------------------------------------------------------------------------
insert into public.price_history (id, organization_id, product_id, changed_by, changed_at, old_price_cents, new_price_cents) values
  ('16000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', now() - interval '10 days', 260000, 270000),
  ('16000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', now() - interval '3 days', 270000, 280000),
  ('16000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002',
   null, now() - interval '5 days', 400000, 420000),
  ('26000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000004', now() - interval '2 days', 1200000, 1250000);
