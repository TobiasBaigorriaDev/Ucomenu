-- Llamado desde la mesa (nivel C; ficha agile/cambios/llamado-desde-la-mesa.md, ADR 0010).
--
-- Aditiva: una tabla nueva, dos columnas con valor por defecto, una restricción única, una función nueva y
-- resolve_table_qr reemplazada (agrega una clave). No toca datos existentes.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop function public.create_waiter_call(text, text, text);
--   drop table public.waiter_calls;
--   alter table public.tables drop constraint tables_id_branch_org_key, drop column muted_until;
--   alter table public.branches drop column waiter_call_cooldown_seconds;
--   y volver a crear resolve_table_qr con la definición de 20261014035425_tables_and_qr.sql.
--
-- Reglas de fondo:
--  * La ÚNICA puerta de escritura es public.create_waiter_call (SECURITY DEFINER): ningún rol de la API inserta,
--    modifica ni borra waiter_calls. «Marcar atendido» llega con el panel de sala (su política y sus columnas).
--  * Un pendiente por (mesa, tipo): índice único parcial + advisory lock por mesa. El límite por cliente (que cuenta en todas
--    las mesas) toma además un advisory lock por cliente, siempre después del de la mesa. Un pendiente vence a los 30
--    minutos de forma DERIVADA (sin cron): la función marca como vencidos los pendientes viejos de esa mesa antes
--    de decidir, así uno viejo nunca bloquea el índice único.
--  * Sin plan o sin la cuenta al día (has_feature), con la mesa inactiva o silenciada o la organización inactiva:
--    un único resultado «unavailable», sin revelar la causa.
--  * client_key es un HMAC de la IP calculado por el servidor de la app (nunca la IP en claro). Quien llame a la API
--    directo puede elegir ese valor: es un límite de segunda línea (decisión del usuario, ADR 0010).

-- ---------------------------------------------------------------------------
-- Columnas y restricciones de apoyo
-- ---------------------------------------------------------------------------

-- Silenciar una mesa ante abuso (la UI llega con «Configuración del llamado»; hoy ningún rol de la API lo escribe).
alter table public.tables add column muted_until timestamptz;
comment on column public.tables.muted_until is
  'Mientras sea futura, la mesa no admite llamados (resultado «unavailable»). Nula = no silenciada.';

-- Permite la clave foránea compuesta de waiter_calls: un llamado siempre coincide con la sucursal y organización de su mesa.
alter table public.tables
  add constraint tables_id_branch_org_key unique (id, branch_id, organization_id);

alter table public.branches
  add column waiter_call_cooldown_seconds integer not null default 60
    check (waiter_call_cooldown_seconds between 10 and 3600);
comment on column public.branches.waiter_call_cooldown_seconds is
  'Segundos mínimos entre dos llamados del mismo tipo desde la misma mesa. Por defecto 60.';

-- ---------------------------------------------------------------------------
-- Llamados
-- ---------------------------------------------------------------------------

create table public.waiter_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  table_id uuid not null,
  kind text not null
    check (kind in ('waiter', 'bill')),
  status text not null default 'pending'
    check (status in ('pending', 'attended', 'expired')),
  created_at timestamptz not null default now(),
  attended_at timestamptz,
  attended_by uuid references auth.users (id) on delete set null,
  -- HMAC de la IP del comensal armado por el servidor de la app. Nunca la IP en claro.
  client_key text
    check (client_key is null or client_key ~ '^[0-9a-f]{32}$'),
  foreign key (table_id, branch_id, organization_id)
    references public.tables (id, branch_id, organization_id) on delete cascade
);
comment on table public.waiter_calls is
  'Llamados al mozo y pedidos de cuenta. Solo escribe create_waiter_call; el personal los lee (y los atiende desde el panel de sala).';

-- Como máximo un pendiente por mesa y tipo, también con concurrencia.
create unique index waiter_calls_one_pending_key on public.waiter_calls (table_id, kind) where status = 'pending';
-- Panel de sala: pendientes de una sucursal, los más recientes primero.
create index waiter_calls_branch_status_idx on public.waiter_calls (branch_id, status, created_at desc);
-- Cooldown: último llamado de una mesa y tipo.
create index waiter_calls_table_kind_idx on public.waiter_calls (table_id, kind, created_at desc);
-- Límite por cliente.
create index waiter_calls_client_idx on public.waiter_calls (client_key, created_at desc) where client_key is not null;
-- La clave foránea necesita buscar por organización en los borrados en cascada.
create index waiter_calls_organization_id_idx on public.waiter_calls (organization_id);

alter table public.waiter_calls enable row level security;

create policy "waiter_calls: lectura de miembros"
  on public.waiter_calls for select
  to authenticated
  using (private.is_org_member(organization_id));

-- Sin INSERT, UPDATE ni DELETE para ningún rol de la API. anon no lee nada.
revoke all on table public.waiter_calls from anon, authenticated;
grant select on table public.waiter_calls to authenticated;

-- ---------------------------------------------------------------------------
-- La única puerta de escritura
-- ---------------------------------------------------------------------------
-- Devuelve siempre un jsonb {status, ...} y no lanza errores en los flujos normales:
--   created | already_pending | cooldown {retry_after_seconds} | rate_limited {retry_after_seconds}
--   | unavailable | not_found
-- Constantes (ficha): vencimiento 30 min; límite por cliente 30 llamados nuevos cada 10 min.

create function public.create_waiter_call(p_token text, p_kind text, p_client text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_client text;
  v_last timestamptz;
  v_count integer;
  v_oldest timestamptz;
  v_retry integer;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill')
     or p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select t.id, t.organization_id, t.branch_id, t.is_active, t.muted_until,
         b.waiter_call_cooldown_seconds as cooldown
    into v_table
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where t.qr_token = p_token
    and o.is_active;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Serializa los llamados de una misma mesa: dos toques simultáneos no crean dos pendientes.
  perform pg_advisory_xact_lock(hashtextextended('waiter_call:' || v_table.id::text, 0));

  if not v_table.is_active
     or (v_table.muted_until is not null and v_table.muted_until > now())
     or not private.has_feature(v_table.organization_id, 'waiter_call') then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Un pendiente de más de 30 minutos vence solo: no puede bloquear el índice único.
  update public.waiter_calls
  set status = 'expired'
  where table_id = v_table.id
    and status = 'pending'
    and created_at <= now() - interval '30 minutes';

  if exists (
    select 1 from public.waiter_calls
    where table_id = v_table.id and kind = p_kind and status = 'pending'
  ) then
    return jsonb_build_object('status', 'already_pending');
  end if;

  -- Límite por cliente (segunda línea de defensa). Un valor ausente o con otro formato no se cuenta.
  v_client := case when p_client ~ '^[0-9a-f]{32}$' then p_client end;
  if v_client is not null then
    -- El contador abarca TODAS las mesas del cliente y el lock de arriba es por mesa: sin esto, dos pedidos
    -- simultáneos del mismo cliente a mesas distintas leerían el mismo conteo e insertarían ambos (31 avisos).
    -- El lock se toma SIEMPRE después del de la mesa (mesa, luego cliente): el orden fijo evita interbloqueos.
    -- Se libera al terminar la transacción, o sea después del insert; en READ COMMITTED el conteo siguiente ya
    -- ve lo que confirmó quien tenía el lock.
    perform pg_advisory_xact_lock(hashtextextended('waiter_client:' || v_client, 0));

    select count(*), min(created_at) into v_count, v_oldest
    from public.waiter_calls
    where client_key = v_client
      and created_at > now() - interval '10 minutes';

    if v_count >= 30 then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::integer);
      return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', v_retry);
    end if;
  end if;

  -- Cooldown por mesa y tipo, contado desde la creación del llamado anterior aunque ya esté atendido.
  select max(created_at) into v_last
  from public.waiter_calls
  where table_id = v_table.id and kind = p_kind;

  if v_last is not null and v_last + make_interval(secs => v_table.cooldown) > now() then
    v_retry := greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => v_table.cooldown) - now())))::integer);
    return jsonb_build_object('status', 'cooldown', 'retry_after_seconds', v_retry);
  end if;

  -- El lock de arriba serializa los llamados de la mesa; si aun así otro pendiente del mismo tipo se coló (índice
  -- único parcial), se responde igual que si se hubiera visto antes: nunca un error ni un segundo pendiente.
  begin
    insert into public.waiter_calls (organization_id, branch_id, table_id, kind, client_key)
    values (v_table.organization_id, v_table.branch_id, v_table.id, p_kind, v_client);
  exception when unique_violation then
    return jsonb_build_object('status', 'already_pending');
  end;

  return jsonb_build_object('status', 'created');
end;
$$;
comment on function public.create_waiter_call(text, text, text) is
  'Única puerta de escritura de waiter_calls (ADR 0010). Público: valida token, disponibilidad, vencimiento, un pendiente por tipo, límite por cliente y cooldown.';

revoke all on function public.create_waiter_call(text, text, text) from public, anon, authenticated;
grant execute on function public.create_waiter_call(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_table_qr: agrega calls_enabled (se muestran los botones solo si se puede llamar)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_table_qr(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_slug', o.slug,
    'org_name', o.name,
    'branch_slug', b.slug,
    'table_label', t.label,
    'table_active', t.is_active,
    'status', case when private.org_is_published(o.id) then 'available' else 'suspended' end,
    'calls_enabled', (
      t.is_active
      and (t.muted_until is null or t.muted_until <= now())
      and private.has_feature(o.id, 'waiter_call')
    )
  )
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where p_token ~ '^[0-9a-f]{32}$'
    and t.qr_token = p_token
    and o.is_active;
$$;
