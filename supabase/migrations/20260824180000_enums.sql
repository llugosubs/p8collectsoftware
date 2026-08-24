-- ============================================================================
-- 0002 — Enums del dominio (Fase 1)
--
-- Todos los tipos cerrados del modelo, en un solo lugar. Van primero porque
-- las tablas de las migraciones siguientes los usan.
-- ============================================================================

-- --- Inventario -------------------------------------------------------------

create type public.item_type as enum (
  'graded_card', 'raw_card', 'sealed_box', 'sealed_pack', 'lot', 'supply'
);

create type public.item_category as enum ('sports', 'tcg', 'other');

create type public.grading_company as enum ('PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'none');

create type public.raw_condition as enum ('NM', 'LP', 'MP', 'HP', 'DMG');

-- 'consumed' no está en la sección 5.1 del master prompt, pero la 5.3 lo exige:
-- una caja que se abre para un break no se vendió, se consumió.
create type public.item_status as enum (
  'incoming', 'in_stock', 'listed', 'reserved', 'sold',
  'consigned_out', 'returned', 'lost', 'consumed'
);

create type public.owner_type as enum ('own', 'consignment');

create type public.image_kind as enum ('front', 'back', 'cert', 'detail');

create type public.valuation_source as enum (
  'manual', 'psa', 'ebay_sold', '130point', 'tcgplayer', 'other'
);

-- --- Compras ----------------------------------------------------------------

create type public.acquisition_platform as enum (
  'alt', 'goldin', 'ebay', 'whatnot', 'fanatics', 'pwcc', 'private', 'retail', 'other'
);

create type public.acquisition_payment_status as enum ('pending', 'partial', 'paid');

create type public.acquisition_received_status as enum (
  'pending', 'in_transit', 'received', 'partial'
);

-- --- Ventas -----------------------------------------------------------------

create type public.sales_channel as enum (
  'store', 'whatnot', 'instagram', 'tiktok', 'ebay', 'in_person', 'other'
);

create type public.order_status as enum (
  'draft', 'pending_payment', 'paid', 'packing', 'shipped', 'delivered',
  'cancelled', 'refunded'
);

-- --- Pagos y finanzas -------------------------------------------------------

create type public.payment_direction as enum ('in', 'out');

create type public.payment_method as enum (
  'zelle', 'pago_movil', 'transfer_bs', 'binance', 'cash_usd', 'cash_bs',
  'stripe', 'paypal', 'card', 'other'
);

create type public.payment_verification_status as enum (
  'pending_verification', 'verified', 'rejected'
);

create type public.account_type as enum (
  'bank_ve', 'bank_us', 'zelle', 'binance', 'cash', 'platform_balance', 'card'
);

create type public.transaction_type as enum (
  'sale', 'purchase', 'expense', 'transfer', 'fx_exchange', 'adjustment', 'consignor_payout'
);

create type public.fx_source as enum ('bcv', 'binance', 'manual');

-- --- Consignación -----------------------------------------------------------

create type public.consignment_agreement_status as enum (
  'active', 'sold', 'returned', 'expired'
);

create type public.consignor_payout_status as enum ('pending', 'paid');

-- --- Sistema ----------------------------------------------------------------

create type public.audit_action as enum ('insert', 'update', 'delete');
