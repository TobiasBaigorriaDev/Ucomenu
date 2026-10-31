-- Voz del local (nivel C, ADR 0050): lema, horarios, Instagram y WhatsApp que el Dueño publica en la carta pública.
-- Ficha: agile/cambios/personalizacion-ampliada-de-la-carta.md
--
-- Qué hace:
--  * Cuatro columnas NULL en `organizations` (nulo = no se muestra): `menu_tagline` (hasta 80 caracteres), `opening_hours` (hasta
--    160), `instagram_handle` (usuario, `[A-Za-z0-9._]{1,30}`) y `whatsapp_number` (solo dígitos, 8 a 15). Los textos no admiten
--    caracteres de control ni marcas invisibles de dirección o ancho cero. La base guarda IDENTIFICADORES, no direcciones: el
--    servidor arma `instagram.com/{usuario}` y `wa.me/{número}`, así que no hay forma de guardar un enlace a otro sitio.
--  * Solo el Dueño las edita: `grant update` de columna a `authenticated` + la política vigente de UPDATE de organizations
--    (Dueño y cuenta al día). El Staff, los demás locales y `anon` no pueden escribirlas.
--  * Lectura pública: la deja el SELECT que ya tienen `anon` y `authenticated` sobre `organizations` (la carta lee su fila); una
--    organización suspendida o dada de baja no expone nada, como con el resto de la identidad. Es información que el local
--    decide publicar; si el Dueño carga un teléfono personal, queda visible para cualquiera (el panel lo avisa).
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   revoke update (menu_tagline, opening_hours, instagram_handle, whatsapp_number) on public.organizations from authenticated;
--   alter table public.organizations drop column menu_tagline, drop column opening_hours, drop column instagram_handle, drop column whatsapp_number;
--   (se pierden los textos cargados).
alter table public.organizations
  add column menu_tagline text,
  add column opening_hours text,
  add column instagram_handle text,
  add column whatsapp_number text,
  add constraint organizations_menu_tagline_check
    check (menu_tagline is null or (char_length(menu_tagline) between 1 and 80 and menu_tagline !~ '[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]')),
  add constraint organizations_opening_hours_check
    check (opening_hours is null or (char_length(opening_hours) between 1 and 160 and opening_hours !~ '[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]')),
  add constraint organizations_instagram_handle_check
    check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  add constraint organizations_whatsapp_number_check
    check (whatsapp_number is null or whatsapp_number ~ '^[0-9]{8,15}$');

comment on column public.organizations.menu_tagline is 'Lema corto bajo el nombre del local en la carta pública. Texto plano, hasta 80 caracteres.';
comment on column public.organizations.opening_hours is 'Horarios en una línea para el pie de la carta pública. Texto plano, hasta 160 caracteres.';
comment on column public.organizations.instagram_handle is 'Usuario de Instagram (sin @ ni enlace). El enlace lo arma el servidor.';
comment on column public.organizations.whatsapp_number is 'Número de WhatsApp del local en formato internacional, solo dígitos. El enlace wa.me lo arma el servidor.';

grant update (menu_tagline, opening_hours, instagram_handle, whatsapp_number) on public.organizations to authenticated;
