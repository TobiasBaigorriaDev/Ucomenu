-- Videos del feed, parte B (Mux real): `menu_videos.mux_error`, el motivo por el que un video quedó con error.
-- Ficha: agile/cambios/videos-mux-parte-b.md · ADR 0031.
--
-- Aditiva: una columna nueva con su CHECK y un permiso de lectura. La escribe solo el servidor (webhook de Mux, con
-- service_role): la persona no recibe permiso de escritura sobre ella, igual que sobre mux_status. Las sentencias van en una
-- transacción explícita porque el CLI las ejecuta una por una, y son idempotentes por si una corrida se corta.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, en UNA transacción:
--   alter table public.menu_videos drop column mux_error;   (se pierde solo el motivo de los videos con error)

begin;

alter table public.menu_videos add column if not exists mux_error text;

alter table public.menu_videos drop constraint if exists menu_videos_mux_error_check;
alter table public.menu_videos add constraint menu_videos_mux_error_check
  check (
    mux_error is null
    or (mux_status = 'errored' and mux_error in ('too_long', 'no_playback', 'processing_failed', 'upload_failed'))
  );

comment on column public.menu_videos.mux_error is
  'Por qué quedó con error (too_long, no_playback, processing_failed, upload_failed). Solo con mux_status = errored; lo escribe el servidor.';

-- Dueño y Staff lo leen para mostrarlo; nadie con sesión lo escribe (no hay permiso de INSERT ni de UPDATE sobre la columna).
grant select (mux_error) on table public.menu_videos to authenticated;

commit;
