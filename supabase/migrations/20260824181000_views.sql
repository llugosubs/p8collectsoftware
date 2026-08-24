-- ============================================================================
-- 0012 — Vistas derivadas (Fase 1)
--
-- Todas con `security_invoker = true`: se ejecutan con los permisos de quien
-- consulta, así que el RLS de las tablas de abajo sigue aplicando. Sin eso, una
-- vista correría como su dueño y sería un agujero por el que se ve todo.
--
-- Los saldos se expresan en USD, la moneda base. Comparar el total de una orden
-- en bolívares contra un pago en dólares sin convertir da un número sin
-- sentido, y ese número decidiría a quién se le cobra.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- items_with_costs
--
-- El truco que hace innecesario enmascarar columnas: para `owner` y `admin` el
-- LEFT JOIN trae la fila de costo; para `staff` y `viewer` el RLS de
-- `item_costs` la esconde y el join deja NULL. La regla la impone la base, no
-- una condición escrita en la vista.
-- ---------------------------------------------------------------------------
create view public.items_with_costs with (security_invoker = true) as
select
  i.*,
  c.allocated_cost,
  c.grading_cost,
  c.other_cost,
  c.cost_basis,
  case
    when c.cost_basis is not null and i.market_value is not null
      then i.market_value - c.cost_basis
  end as unrealized_gain
from public.items i
left join public.item_costs c on c.item_id = i.id;

comment on view public.items_with_costs is
  'Inventario con su costo. Quien no puede ver costos recibe NULL, por RLS, no por filtro.';

-- ---------------------------------------------------------------------------
-- order_lines_with_costs
-- ---------------------------------------------------------------------------
create view public.order_lines_with_costs with (security_invoker = true) as
select
  l.*,
  c.cost_basis_snapshot,
  c.allocated_order_cost,
  c.gross_margin
from public.order_lines l
left join public.order_line_costs c on c.order_line_id = l.id;

-- ---------------------------------------------------------------------------
-- receivables — órdenes con saldo pendiente
-- ---------------------------------------------------------------------------
create view public.receivables with (security_invoker = true) as
select
  o.id as order_id,
  o.order_number,
  o.customer_id,
  o.channel,
  o.status,
  o.currency,
  o.total,
  -- El total llevado a la moneda base con la tasa que quedó registrada en la
  -- orden, no con la de hoy.
  round(case when o.currency = 'USD' then o.total else o.total / o.fx_rate end, 4)
    as total_usd,
  coalesce(p.paid_usd, 0) as paid_usd,
  round(case when o.currency = 'USD' then o.total else o.total / o.fx_rate end, 4)
    - coalesce(p.paid_usd, 0) as balance_usd,
  o.placed_at,
  o.due_at,
  case
    when o.due_at is not null and o.due_at < now()
      then extract(day from now() - o.due_at)::int
    else 0
  end as days_overdue
from public.orders o
left join lateral (
  select sum(pay.amount_usd_equivalent) as paid_usd
  from public.payments pay
  where pay.order_id = o.id
    and pay.direction = 'in'
    and pay.status = 'verified'
    and pay.deleted_at is null
) p on true
where o.deleted_at is null
  and o.status not in ('draft', 'cancelled', 'refunded')
  and round(case when o.currency = 'USD' then o.total else o.total / o.fx_rate end, 4)
      - coalesce(p.paid_usd, 0) > 0;

-- ---------------------------------------------------------------------------
-- payables — lo que se debe
--
-- Dos orígenes distintos en una sola lista, porque la pregunta del dueño es
-- "¿cuánto debo?", no "¿cuánto le debo a cada tipo de acreedor?".
-- ---------------------------------------------------------------------------
create view public.payables with (security_invoker = true) as
select
  'acquisition'::text as kind,
  a.id as reference_id,
  coalesce(a.reference, a.platform::text) as label,
  a.currency,
  round(case when a.currency = 'USD' then a.total_cost else a.total_cost / a.fx_rate end, 4)
    as total_usd,
  coalesce(p.paid_usd, 0) as paid_usd,
  round(case when a.currency = 'USD' then a.total_cost else a.total_cost / a.fx_rate end, 4)
    - coalesce(p.paid_usd, 0) as balance_usd,
  a.due_at::timestamptz as due_at,
  case
    when a.due_at is not null and a.due_at < current_date
      then (current_date - a.due_at)
    else 0
  end as days_overdue
from public.acquisitions a
left join lateral (
  select sum(pay.amount_usd_equivalent) as paid_usd
  from public.payments pay
  where pay.acquisition_id = a.id
    and pay.direction = 'out'
    and pay.status = 'verified'
    and pay.deleted_at is null
) p on true
where a.deleted_at is null
  and a.payment_status <> 'paid'

union all

select
  'consignor_payout'::text as kind,
  cp.id as reference_id,
  co.display_name as label,
  'USD'::char(3) as currency,
  cp.net_to_consignor as total_usd,
  0::numeric as paid_usd,
  cp.net_to_consignor as balance_usd,
  null::timestamptz as due_at,
  0 as days_overdue
from public.consignor_payouts cp
join public.consignors co on co.id = cp.consignor_id
where cp.status = 'pending';
