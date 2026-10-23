-- Zona horaria por sucursal (nivel M). Ficha: agile/cambios/zona-horaria-por-sucursal.md · ADR 0040, decisión 1 ·
-- docs/producto.md, módulo 8.
--
-- Qué hace:
--  * `branches.timezone` (no nulo, por defecto `America/Argentina/Buenos_Aires`): la zona horaria con la que la sucursal lee
--    su reloj en la lógica OPERATIVA (promociones y pedidos, que vienen después). Las sucursales existentes quedan en Buenos
--    Aires, que es lo que ya usaba toda la base.
--  * `CHECK` con una lista CERRADA de zonas IANA (América, más Madrid y Lisboa). Es la misma lista que `BRANCH_TIME_ZONES` de
--    `src/lib/sucursales/rules.ts`; ampliarla es una migración. Una prueba confirma que Postgres conoce cada una (si no, un
--    `at time zone` fallaría en pleno cálculo de precio). Una lista cerrada evita nombres que Postgres acepta pero la
--    aplicación no (abreviaturas como `EST`, `posix/…`, o nombres que el Node de la aplicación no tenga en su ICU).
--  * Solo el Dueño la edita: `grant update (timezone)` a `authenticated` y la política vigente de UPDATE de `branches` (Dueño y
--    cuenta al día). El alta de sucursales sigue sin poder fijarla (queda en el valor por defecto; se cambia después).
--  * Lectura pública: la deja el SELECT que ya tienen `anon` y `authenticated` sobre `branches`, filtrado por la política de
--    sucursales activas y publicadas. La carta la necesitará para decidir qué promoción rige.
--
-- NO cambia: facturación, vencimientos, mora, analítica ni el tema de fechas, que siguen en la hora de Argentina (ADR 0040).
--
-- Sin funciones ni cambios de permisos más allá del privilegio de columna. Rollback (local): git revert + `pnpm db:reset`. En una
-- base con datos: `revoke update (timezone) on public.branches from authenticated;`
-- `alter table public.branches drop constraint branches_timezone_check, drop column timezone;` (se pierden las zonas elegidas).

alter table public.branches add column timezone text not null default 'America/Argentina/Buenos_Aires';

alter table public.branches add constraint branches_timezone_check
  check (
    timezone in (
      'America/Argentina/Buenos_Aires',
      'America/Montevideo',
      'America/Santiago',
      'America/Asuncion',
      'America/La_Paz',
      'America/Sao_Paulo',
      'America/Lima',
      'America/Bogota',
      'America/Guayaquil',
      'America/Caracas',
      'America/Mexico_City',
      'America/Panama',
      'America/Costa_Rica',
      'America/Guatemala',
      'America/Santo_Domingo',
      'America/Puerto_Rico',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Europe/Madrid',
      'Europe/Lisbon'
    )
  );

comment on column public.branches.timezone is
  'Zona horaria IANA de la sucursal (lista cerrada). Rige la hora de las promociones y los pedidos; la facturación y la mora siguen en hora de Argentina. La edita solo el Dueño.';

grant update (timezone) on table public.branches to authenticated;
