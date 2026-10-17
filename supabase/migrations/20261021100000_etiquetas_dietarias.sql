-- Declaraciones del local, no certificaciones. Conserva las políticas de products.
alter table public.products
  add column dietary_tags text[] not null default '{}'
    check (
      cardinality(dietary_tags) <= 3
      and dietary_tags <@ array['gluten_free', 'vegan', 'vegetarian']::text[]
      and array_position(dietary_tags, null) is null
      and (cardinality(dietary_tags) = 0 or array_ndims(dietary_tags) = 1)
    );
comment on column public.products.dietary_tags is
  'Etiquetas dietarias declaradas por el establecimiento. Vacío = sin declaración. No se infieren etiquetas.';
grant insert (dietary_tags), update (dietary_tags) on public.products to authenticated;
