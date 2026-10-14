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

-- ---------------------------------------------------------------------------
-- Usuarios de ejemplo (SOLO DESARROLLO Y PRUEBAS). Contraseña pública: ucomenu-dev-2026.
-- Nunca se cargan en producción: el seed solo corre con `supabase db reset` local.
-- Las pruebas E2E y de base dependen de estos usuarios.
--   dueno@cafe-ejemplo.test / mozo@cafe-ejemplo.test         → Café Ejemplo (owner / staff)
--   dueno@parrilla-demo.test / mozo@parrilla-demo.test       → Parrilla Demo
--   dueno@resto-moroso.test / mozo@resto-moroso.test         → Resto Moroso (cuenta vencida)
--   multi@ucomenu.test                                       → owner en Café Ejemplo y staff en Parrilla Demo
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
      ('a0000000-0000-4000-8000-000000000007'::uuid, 'multi@ucomenu.test')
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
