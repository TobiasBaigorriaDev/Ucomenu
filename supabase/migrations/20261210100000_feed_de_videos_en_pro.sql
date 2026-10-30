-- El feed de videos cortos pasa al plan Pro (nivel C: planes y límites). Ficha: agile/cambios/feed-de-videos-en-pro.md · ADR 0049
-- (enmienda a 0031). Decisión del usuario, 2026-10-29: Premium deja de ofrecerse y todo lo ya construido queda en Pro.
--
-- Qué hace:
--  * `plans`, fila `pro`: se agrega la feature `video_feed` y `max_videos_published` pasa de 0 a 10, el mismo cupo que tenía Premium.
--    Es idempotente: si la feature ya está, no la repite; el cupo se fija en 10 solo si todavía es 0 o nulo (no pisa un valor
--    distinto; hoy Pro está en 0).
--  * Nada más cambia: ni `basic` (sin feed, cupo 0), ni `premium` (sigue existiendo, con su feature y su cupo, aunque no se venda),
--    ni el `check` de features (`video_feed` ya está permitida), ni funciones ni políticas. El acceso al feed se decide por feature
--    (`private.has_feature`, `public.org_entitlements`), no por el nombre del plan: subir, publicar, dar like y comentar siguen
--    exigiendo además `private.org_can_write` (cuenta al día), y el cupo se sigue comprobando al publicar.
--
-- Sin cambios de permisos: no se crea ni se modifica ninguna función ni política; nada nuevo se abre a anon ni a authenticated.
--
-- Efecto sobre datos existentes: las organizaciones en Pro ganan el feed al instante; no se toca ningún video ni suscripción. Las
-- que estén en Premium conservan todo.
--
-- Rollback (en UNA transacción): `update public.plans set features = array_remove(features, 'video_feed'), max_videos_published = 0
-- where code = 'pro';` Los videos ya publicados por organizaciones Pro no se borran, pero mientras el plan no conceda `video_feed`
-- no se puede crear ni publicar (se puede despublicar y renombrar) y la lectura pública deja de mostrarlos (la política y
-- `private.has_feature` exigen la feature); vuelven a verse si se la vuelve a conceder.

begin;

update public.plans
set features = case when 'video_feed' = any(features) then features else array_append(features, 'video_feed') end,
    max_videos_published = case when coalesce(max_videos_published, 0) = 0 then 10 else max_videos_published end
where code = 'pro';

commit;
