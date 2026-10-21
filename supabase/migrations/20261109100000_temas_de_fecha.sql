-- Temas de fechas especiales de la carta (San Valentín, Navidad, Halloween…): decoración opcional con una ventana de fechas.
-- Aditiva: los locales existentes quedan en 'ninguno'. Mismo permiso de escritura que el resto de la identidad (Dueño +
-- org_can_write, por la política de organizations). La lista debe coincidir con `THEMES` en `src/lib/identidad/temas.ts`.
-- Las fechas son días calendario de Buenos Aires, inclusivos; cualquiera de las dos puede faltar.
alter table public.organizations
  add column menu_theme text not null default 'ninguno'
    check (menu_theme in (
      'ninguno', 'sanvalentin', 'pascuas', 'diamadre', 'diapadre', 'patrias', 'diaamigo', 'halloween', 'navidad', 'anionuevo'
    )),
  add column menu_theme_from date,
  add column menu_theme_until date,
  add constraint organizations_menu_theme_window_check
    check (menu_theme_from is null or menu_theme_until is null or menu_theme_until >= menu_theme_from);

grant update (menu_theme, menu_theme_from, menu_theme_until) on public.organizations to authenticated;
