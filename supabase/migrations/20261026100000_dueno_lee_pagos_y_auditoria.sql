-- El Dueño lee los pagos y el historial de cambios de SU cuenta (nivel C; ficha dueno-lee-pagos-y-auditoria, ADR 0021).
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos (no hay datos propios que perder):
--   drop function public.owner_payments(uuid, integer, timestamptz);
--   drop function public.owner_account_history(uuid, integer, timestamptz);
--
-- Decisiones:
--  * `payments` y `audit_log` NO reciben política de lectura para el Dueño: siguen siendo de SuperAdmin. Contienen datos que
--    el cliente no debe ver (quién del equipo de UcoMenu actuó, motivos escritos a mano, ids de usuarios de terceros).
--    En su lugar, dos funciones SECURITY DEFINER entregan una proyección elegida columna por columna y acción por acción.
--  * Solo un Dueño ACTUAL de la organización recibe filas; cualquier otra identidad (Staff, Dueño de otro local, sin rol,
--    anon, SuperAdmin sin membresía) recibe cero filas, igual que con un local inexistente.
--  * Lista blanca de acciones: una acción nueva de `audit_log` queda oculta hasta que se sume a propósito a esta función.
--  * Solo leen. Paginación por fecha con tope de 100 filas por pedido.

-- ---------------------------------------------------------------------------
-- Pagos de la organización
-- ---------------------------------------------------------------------------
-- No devuelve `registered_by` (quién del equipo lo cargó) ni ids internos.
create function public.owner_payments(
  p_org uuid,
  p_limit integer default 24,
  p_before timestamptz default null
)
returns table (
  id uuid,
  created_at timestamptz,
  paid_on date,
  plan_code text,
  billing_cycle text,
  amount_cents bigint,
  currency text,
  method text,
  reference text,
  previous_period_end timestamptz,
  covers_until timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or not private.is_org_owner(p_org) then
    return;
  end if;

  return query
  select p.id, p.created_at, p.paid_on, p.plan_code, p.billing_cycle, p.amount_cents, p.currency, p.method, p.reference,
         p.previous_period_end, p.covers_until
  from public.payments p
  where p.organization_id = p_org
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
end;
$$;
comment on function public.owner_payments(uuid, integer, timestamptz) is
  'Pagos de la organización para su Dueño actual (cero filas para cualquier otra identidad). Sin registered_by. Solo lee.';

-- ---------------------------------------------------------------------------
-- Historial de cambios de la cuenta
-- ---------------------------------------------------------------------------
-- El detalle se arma clave por clave desde `before`/`after`: nunca sale el JSON crudo ni actor_id, actor_email, el motivo,
-- owner_user_id, el nombre o el slug de otras organizaciones. El autor siempre es «Equipo de UcoMenu» (lo pone la pantalla).
create function public.owner_account_history(
  p_org uuid,
  p_limit integer default 25,
  p_before timestamptz default null
)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or not private.is_org_owner(p_org) then
    return;
  end if;

  return query
  select
    a.id,
    a.created_at,
    a.action,
    jsonb_strip_nulls(
      case a.action
        when 'organization.created' then jsonb_build_object(
          'plan', a.after -> 'plan',
          'billing_cycle', a.after -> 'billing_cycle',
          'period_end', a.after -> 'period_end')
        when 'subscription.plan_changed' then jsonb_build_object(
          'from_plan', a.before -> 'plan',
          'from_billing_cycle', a.before -> 'billing_cycle',
          'plan', a.after -> 'plan',
          'billing_cycle', a.after -> 'billing_cycle')
        when 'subscription.reactivated' then jsonb_build_object('state', a.after -> 'state')
        when 'payment.registered' then jsonb_build_object(
          'plan', a.after -> 'plan',
          'billing_cycle', a.after -> 'billing_cycle',
          'amount_cents', a.after -> 'amount_cents',
          'currency', a.after -> 'currency',
          'method', a.after -> 'method',
          'paid_on', a.after -> 'paid_on',
          'previous_period_end', a.before -> 'period_end',
          'period_end', a.after -> 'period_end')
        when 'owner.added' then jsonb_build_object('promoted', coalesce(a.after -> 'promoted', 'false'::jsonb))
        else '{}'::jsonb -- 'subscription.suspended': sin detalle (el motivo es interno)
      end
    )
  from public.audit_log a
  where a.organization_id = p_org
    and a.action in (
      'organization.created',
      'subscription.plan_changed',
      'subscription.suspended',
      'subscription.reactivated',
      'payment.registered',
      'owner.added'
    )
    and (p_before is null or a.created_at < p_before)
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;
comment on function public.owner_account_history(uuid, integer, timestamptz) is
  'Historial de cambios de la cuenta para su Dueño actual (cero filas para cualquier otra identidad). Lista blanca de acciones y de claves; sin actor, motivo ni ids de terceros. Solo lee.';

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- PUBLIC recibe EXECUTE por defecto: se parte de cero. Solo una sesión de persona (la función vuelve a comprobar que sea
-- Dueño de la organización); anon y service_role no las necesitan.
revoke all on function public.owner_payments(uuid, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.owner_account_history(uuid, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.owner_payments(uuid, integer, timestamptz) to authenticated;
grant execute on function public.owner_account_history(uuid, integer, timestamptz) to authenticated;
