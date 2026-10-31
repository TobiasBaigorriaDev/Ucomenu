-- Vibración de los avisos (nivel M): el Dueño elige cuánto vibra el celular cuando una mesa llama, pide la cuenta o un pedido queda listo.
-- Ficha: agile/cambios/vibracion-de-aviso.md
--
-- Qué hace:
--  * Una columna en `organizations`: `vibration` con la intensidad (`ninguna`, `suave`, `fuerte`, `muy_fuerte`). La base guarda
--    solo el nivel; el patrón de milisegundos de cada aviso vive en `src/lib/sala/vibracion.ts`. Por defecto `fuerte`.
--  * Solo el Dueño la escribe: `grant update` de columna a `authenticated` + la política vigente de UPDATE de organizations
--    (Dueño y cuenta al día), como `call_tone` y `ready_tone`.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   revoke update (vibration) on public.organizations from authenticated;
--   alter table public.organizations drop column vibration;
alter table public.organizations
  add column vibration text not null default 'fuerte',
  add constraint organizations_vibration_check check (vibration in ('ninguna', 'suave', 'fuerte', 'muy_fuerte'));

comment on column public.organizations.vibration is 'Intensidad de la vibración de los avisos en celulares Android. Nivel del catálogo de src/lib/sala/vibracion.ts.';

grant update (vibration) on public.organizations to authenticated;
