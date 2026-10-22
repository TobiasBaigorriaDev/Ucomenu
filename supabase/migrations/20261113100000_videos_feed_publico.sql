-- Feed de videos: lectura pública de `menu_videos` (fase 2, nivel C). Ficha: agile/cambios/feed-de-videos.md · ADR 0031.
--
-- Aditiva: una función privada, una política de lectura y un permiso de columnas para `anon`. No toca datos ni otras tablas.
-- Las sentencias van en una transacción explícita porque el CLI las ejecuta una por una.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, en UNA transacción:
--   drop policy "menu_videos: lectura pública de publicados y listos con el feed vigente" on public.menu_videos;
--   revoke select on table public.menu_videos from anon;
--   drop function private.video_feed_visible(uuid);
--
-- Reglas de fondo:
--  * Un video se lee públicamente solo si está PUBLICADO y LISTO y su organización tiene el feed vigente: `has_feature(org,
--    'video_feed')` = plan Premium y cuenta no suspendida (en solo lectura se sigue viendo; suspendida o dada de baja, no).
--    Se evalúa en cada lectura (sin caché): bajar de plan o suspender lo oculta en el acto.
--  * Columnas públicas mínimas: id, organization_id, product_id, title, mux_playback_id, duration_seconds, sort_order, created_at.
--    `anon` no lee el estado, el estado de Mux, el error ni los identificadores internos (asset y subida).
--  * `mux_playback_id` es público por diseño (ADR 0031): quien lo conoce reproduce el video, como con las fotos de los platos.
--  * `anon` sigue sin poder escribir: no se le concede ningún otro permiso.

begin;

-- `has_feature` es interna (sin EXECUTE para anon ni authenticated): la política consulta este envoltorio, que solo contesta sí o no.
create function private.video_feed_visible(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_feature(org_id, 'video_feed');
$$;

revoke all on function private.video_feed_visible(uuid) from public, anon, authenticated;
grant execute on function private.video_feed_visible(uuid) to anon, authenticated;

create policy "menu_videos: lectura pública de publicados y listos con el feed vigente"
  on public.menu_videos for select
  to anon, authenticated
  using (
    status = 'published'
    and mux_status = 'ready'
    and private.video_feed_visible(organization_id)
  );

grant select (id, organization_id, product_id, title, mux_playback_id, duration_seconds, sort_order, created_at)
  on table public.menu_videos to anon;

commit;
