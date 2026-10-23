-- Escrituras públicas solo desde el servidor (nivel C). Ficha: agile/cambios/escrituras-publicas-solo-servidor.md · ADR 0038.
--
-- `create_waiter_call`, `set_video_like` y `submit_video_comment` dejan de ser ejecutables por `anon` y `authenticated`: solo
-- `service_role`. Antes, quien tenía la clave pública y un token de mesa podía llamarlas directo y omitir el ticket de visita y la
-- clave de conexión (`p_visit_started_at`, `p_client`, `p_rate`), que arma la acción de servidor. Ahora esa acción es la única
-- puerta: verifica el ticket, arma las claves y recién entonces llama a la base con la clave de servicio.
--
-- No cambia ninguna función ni dato: solo permisos. Las reglas de adentro (token, vigencia, topes, mora) siguen igual.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, en UNA transacción:
--   grant execute on function public.create_waiter_call(text, text, text, timestamptz) to anon, authenticated;
--   grant execute on function public.set_video_like(text, uuid, boolean, text, text, timestamptz) to anon, authenticated;
--   grant execute on function public.submit_video_comment(text, uuid, text, text, text, timestamptz) to anon, authenticated;
--   (y volver el código a `createPublicClient()` en `src/app/t/[token]/actions.ts` y `.../videos/actions.ts`).

begin;

revoke all on function public.create_waiter_call(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_waiter_call(text, text, text, timestamptz) to service_role;

revoke all on function public.set_video_like(text, uuid, boolean, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_video_like(text, uuid, boolean, text, text, timestamptz) to service_role;

revoke all on function public.submit_video_comment(text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_video_comment(text, uuid, text, text, text, timestamptz) to service_role;

commit;
