-- El catálogo de planes pasa de dólares a pesos argentinos (nivel C: dinero). Ficha: agile/cambios/precios-en-pesos.md.
-- Decisión del usuario, 2026-10-31: todo en pesos. La portada ya vendía en pesos y el catálogo seguía en USD, así que el Dueño veía en
-- Suscripción un precio distinto del prometido.
--
-- Qué hace:
--  * `plans.monthly_price_usd_cents` y `yearly_price_usd_cents` se renombran a `monthly_price_cents` y `yearly_price_cents`
--    (y sus `check`): ya no son dólares. Se agrega `price_currency` ('ARS' por defecto; 'USD' sigue siendo válida, como en
--    `payments` y `addons`, pero ningún plan la usa).
--  * Precios de lista en centavos de peso: Básico 14.900 por mes y 143.040 por año (20 % menos que doce meses); Pro 29.000 por mes y
--    278.400 por año (el mismo 20 %). Son los de la portada (`src/lib/marketing/planes.ts`); una prueba RLS los compara.
--  * Premium no se vende: sus precios pasan a nulos («sin precio de lista»), no se inventa una cifra. Las dos columnas son nulas
--    juntas o no nulas juntas.
--
-- Qué NO cambia: límites, features, funciones, políticas ni permisos (la tabla sigue siendo de lectura con sesión; el servidor la
-- escribe). No se toca ninguna suscripción ni ningún pago: lo cobrado de verdad vive en `payments`, con su propia moneda, y la
-- facturación por ahora es manual. Las columnas de `addons` (`monthly_price_usd_cents`, etc.) son legado de WebAR y no se tocan.
--
-- Efecto sobre datos existentes: ninguno sobre organizaciones. Solo cambia lo que se muestra como «precio de lista» (Suscripción).
--
-- Rollback (en UNA transacción; los valores son fieles porque la migración exige esos precios de partida, ver la guarda):
--   alter table public.plans drop constraint plans_prices_together_check;
--   update public.plans set monthly_price_cents = case code when 'basic' then 2000 when 'pro' then 4000 else 7000 end,
--                           yearly_price_cents  = case code when 'basic' then 19000 when 'pro' then 38000 else 67000 end;
--   alter table public.plans alter column monthly_price_cents set not null, alter column yearly_price_cents set not null;
--   alter table public.plans drop column price_currency;
--   alter table public.plans rename column monthly_price_cents to monthly_price_usd_cents;
--   alter table public.plans rename column yearly_price_cents to yearly_price_usd_cents;
--   (y renombrar los dos `check` a su nombre anterior; el código de la aplicación anterior solo funciona con los nombres viejos).

begin;

-- Guarda: el rollback de arriba devuelve valores fijos, así que solo es fiel si los precios de partida son exactamente estos (los del
-- seed de 20261014003848, confirmados en local y en staging el 2026-10-31). Si alguien los cambió a mano, la migración se detiene
-- en vez de pisarlos sin dejar con qué volver (hallazgo de la revisión de Codex, ronda 1).
do $$
begin
  if (select count(*) from public.plans
      where (code, monthly_price_usd_cents, yearly_price_usd_cents) in (('basic', 2000, 19000), ('pro', 4000, 38000), ('premium', 7000, 67000))) <> 3 then
    raise exception 'plans_prices_unexpected: los precios del catálogo no son los esperados; anotarlos antes de migrar y ajustar el rollback' using errcode = '55000';
  end if;
end
$$;

alter table public.plans rename column monthly_price_usd_cents to monthly_price_cents;
alter table public.plans rename column yearly_price_usd_cents to yearly_price_cents;
alter table public.plans rename constraint plans_monthly_price_usd_cents_check to plans_monthly_price_cents_check;
alter table public.plans rename constraint plans_yearly_price_usd_cents_check to plans_yearly_price_cents_check;

alter table public.plans add column price_currency text not null default 'ARS'
  constraint plans_price_currency_check check (price_currency in ('ARS', 'USD'));

alter table public.plans alter column monthly_price_cents drop not null;
alter table public.plans alter column yearly_price_cents drop not null;

update public.plans set monthly_price_cents = 1490000, yearly_price_cents = 14304000, price_currency = 'ARS' where code = 'basic';
update public.plans set monthly_price_cents = 2900000, yearly_price_cents = 27840000, price_currency = 'ARS' where code = 'pro';
update public.plans set monthly_price_cents = null, yearly_price_cents = null, price_currency = 'ARS' where code = 'premium';

alter table public.plans add constraint plans_prices_together_check
  check ((monthly_price_cents is null) = (yearly_price_cents is null));

comment on column public.plans.monthly_price_cents is 'Precio de lista por mes, en centavos de `price_currency`; nulo = el plan no tiene precio de lista (no se vende).';
comment on column public.plans.yearly_price_cents is 'Precio de lista por año, en centavos de `price_currency`; nulo junto con el mensual.';
comment on column public.plans.price_currency is 'Moneda de los precios de lista (hoy ARS). Lo cobrado de verdad vive en `payments`, con su propia moneda.';
comment on table public.plans is
  'Catálogo de planes. Precios de lista en centavos de `price_currency` (pesos); límites nulos = sin límite. Lo modifica solo el servidor.';

commit;
