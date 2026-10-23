-- Enlace de reseñas de Google por sucursal (nivel M). Ficha: agile/cambios/enlace-de-resenas-de-google.md ·
-- docs/producto.md, módulo 9 · docs/arquitectura.md, «Salón y crecimiento».
--
-- Qué hace:
--  * `branches.google_review_url` (nulo = sin enlace): una dirección https cuyo host es EXACTAMENTE uno de los de Google que
--    publican perfiles y reseñas (`g.page`, `search.google.com`, `maps.app.goo.gl`, Maps…), de hasta 500 caracteres, sin espacios,
--    caracteres de control ni barras invertidas, y sin usuario ni puerto (después del host solo puede venir «/…»). La lista es la
--    misma que `GOOGLE_REVIEW_HOSTS` de `src/lib/sucursales/rules.ts`; ampliarla es una migración.
--  * Solo el Dueño la edita: `grant update (google_review_url)` a `authenticated` y la política vigente de UPDATE de `branches`
--    (Dueño y cuenta al día). El Staff y las demás organizaciones no pueden escribirla; `anon` no tiene UPDATE.
--  * Lectura pública: la deja el SELECT que ya tienen `anon` y `authenticated` sobre `branches`, filtrado por la política de
--    sucursales activas y publicadas. Una sucursal desactivada, de una cuenta suspendida o de una organización dada de baja no
--    expone su enlace.
--
-- Sin funciones ni cambios de permisos más allá del privilegio de columna. Rollback (local): git revert + `pnpm db:reset`. En una
-- base con datos: `revoke update (google_review_url) on public.branches from authenticated;`
-- `alter table public.branches drop constraint branches_google_review_url_check, drop column google_review_url;` (se pierden los
-- enlaces cargados).

alter table public.branches add column google_review_url text;

alter table public.branches add constraint branches_google_review_url_check
  check (
    google_review_url is null
    or (
      char_length(google_review_url) between 1 and 500
      and google_review_url ~* '^https://(g\.page|g\.co|goo\.gl|maps\.app\.goo\.gl|share\.google|search\.google\.com|maps\.google\.com|google\.com|www\.google\.com|google\.com\.ar|www\.google\.com\.ar)(/[^[:space:][:cntrl:]\\]*)?$'
    )
  );

comment on column public.branches.google_review_url is
  'Enlace a la página de reseñas de Google de la sucursal (https, host de Google). Lo edita solo el Dueño; lo lee la carta pública.';

grant update (google_review_url) on table public.branches to authenticated;
