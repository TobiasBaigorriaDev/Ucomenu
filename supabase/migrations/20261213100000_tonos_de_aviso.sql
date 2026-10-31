-- Tonos de aviso (nivel M): el Dueño elige qué suena cuando una mesa llama y cuando un pedido queda listo.
-- Ficha: agile/cambios/tonos-de-aviso.md
--
-- Qué hace:
--  * Dos columnas en `organizations`: `call_tone` (llamado de mesa y plato nuevo en cocina) y `ready_tone` (pedido listo para
--    el mozo). Guardan el id de un tono del catálogo cerrado de `src/lib/sala/tonos.ts`, nunca una URL ni un archivo: la base
--    rechaza cualquier otro valor. Los valores por defecto son los MP3 de siempre, así que nada cambia hasta que el Dueño elija.
--  * Solo el Dueño las escribe: `grant update` de columna a `authenticated` + la política vigente de UPDATE de organizations
--    (Dueño y cuenta al día). El Staff, los demás locales y `anon` no pueden escribirlas.
--  * Las lee quien ya lee la fila de la organización (miembros, y la carta pública por su SELECT); el nombre de un tono no es sensible.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   revoke update (call_tone, ready_tone) on public.organizations from authenticated;
--   alter table public.organizations drop column call_tone, drop column ready_tone;
alter table public.organizations
  add column call_tone text not null default 'llamado',
  add column ready_tone text not null default 'plato-listo',
  add constraint organizations_call_tone_check
    check (call_tone in ('llamado', 'plato-listo', 'campana', 'timbre', 'marimba', 'digital', 'alerta')),
  add constraint organizations_ready_tone_check
    check (ready_tone in ('llamado', 'plato-listo', 'campana', 'timbre', 'marimba', 'digital', 'alerta'));

comment on column public.organizations.call_tone is 'Tono que suena en sala, panel y cocina ante un llamado de mesa o un plato nuevo. Id del catálogo de src/lib/sala/tonos.ts.';
comment on column public.organizations.ready_tone is 'Tono que suena al mozo cuando un pedido queda listo en cocina. Id del catálogo de src/lib/sala/tonos.ts.';

grant update (call_tone, ready_tone) on public.organizations to authenticated;
