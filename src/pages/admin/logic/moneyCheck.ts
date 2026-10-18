import type { AllocationRow, OrderRow, PaymentRow, TransferRow, TripRow } from '../types';

export type MoneyFlag =
  | 'negative_margin' | 'margin_high' | 'short_load' | 'supplier_mismatch' | 'driver_mismatch'
  | 'missing_supplier_payout' | 'unpaid_delivered' | 'payout_before_payment';

export interface MoneyCheckInput {
  order: Pick<OrderRow, 'id' | 'number' | 'status' | 'total_cents'>;
  allocations: Pick<AllocationRow, 'id' | 'quantity' | 'supplier_price_cents' | 'birds_counted' | 'status'>[];
  trips: Pick<TripRow, 'id' | 'driver_share_cents' | 'status'>[];
  payments: Pick<PaymentRow, 'status' | 'amount_cents' | 'fee_cents'>[];
  transfers: Pick<TransferRow, 'party_type' | 'amount_cents' | 'status'>[];
  /** The bank's charge on payouts the admin marked paid by EFT. */
  payoutFeesCents: number;
}

export interface MoneyCheck {
  orderId: string; number: string; status: string;
  paidCents: number; supplierExpectedCents: number; supplierPayoutCents: number;
  driverExpectedCents: number; driverPayoutCents: number; bankFeesCents: number;
  marginCents: number; marginPct: number; flags: MoneyFlag[];
}

/** A normal order keeps about a fifth of what the buyer paid; much more than this means someone was underpaid. */
export const HIGH_MARGIN_PCT = 40;

const live = (s: string) => s === 'queued' || s === 'sent' || s === 'success';
const delivered = (s: string) => s === 'delivered' || s === 'settled';

export function checkOrderMoney(i: MoneyCheckInput): MoneyCheck {
  const paid = i.payments.filter((p) => p.status === 'succeeded').reduce((n, p) => n + p.amount_cents, 0);
  const collected = i.allocations.filter((a) => a.status === 'collected');
  const supplierExpected = collected.reduce((n, a) => n + a.supplier_price_cents * Math.min(a.quantity, a.birds_counted ?? a.quantity), 0);
  const supplierPayout = i.transfers.filter((t) => t.party_type === 'supplier' && live(t.status)).reduce((n, t) => n + t.amount_cents, 0);
  const driverExpected = i.trips.filter((t) => t.status === 'delivered').reduce((n, t) => n + t.driver_share_cents, 0);
  const driverPayout = i.transfers.filter((t) => t.party_type === 'driver' && live(t.status)).reduce((n, t) => n + t.amount_cents, 0);
  const bankFees = i.payments.filter((p) => p.status === 'succeeded').reduce((n, p) => n + (p.fee_cents ?? 0), 0) + i.payoutFeesCents;
  const margin = paid - supplierPayout - driverPayout - bankFees;
  const marginPct = paid > 0 ? Math.round((margin / paid) * 1000) / 10 : 0;

  const flags: MoneyFlag[] = [];
  if (paid > 0 && margin < 0) flags.push('negative_margin');
  // Only once something has been paid out: before that, of course the whole payment looks kept.
  if (paid > 0 && marginPct > HIGH_MARGIN_PCT && (collected.length > 0 || delivered(i.order.status))) flags.push('margin_high');
  if (collected.some((a) => a.birds_counted !== null && a.birds_counted < a.quantity)) flags.push('short_load');
  if (collected.length > 0 && supplierPayout === 0) flags.push('missing_supplier_payout');
  else if (collected.length > 0 && supplierPayout !== supplierExpected) flags.push('supplier_mismatch');
  if (i.trips.some((t) => t.status === 'delivered') && driverPayout !== driverExpected) flags.push('driver_mismatch');
  if (delivered(i.order.status) && paid < i.order.total_cents) flags.push('unpaid_delivered');
  if (paid < i.order.total_cents && i.transfers.some((t) => live(t.status))) flags.push('payout_before_payment');

  return {
    orderId: i.order.id, number: i.order.number, status: i.order.status, paidCents: paid,
    supplierExpectedCents: supplierExpected, supplierPayoutCents: supplierPayout,
    driverExpectedCents: driverExpected, driverPayoutCents: driverPayout,
    bankFeesCents: bankFees, marginCents: margin, marginPct, flags,
  };
}

export function summarize(checks: MoneyCheck[]) {
  return {
    orders: checks.length,
    flagged: checks.filter((c) => c.flags.length > 0).length,
    paidCents: checks.reduce((n, c) => n + c.paidCents, 0),
    marginCents: checks.reduce((n, c) => n + c.marginCents, 0),
  };
}

/** Flagged orders first, then newest-looking first (the order they came in). */
export function sortChecks(checks: MoneyCheck[]): MoneyCheck[] {
  return [...checks].sort((a, b) => b.flags.length - a.flags.length);
}
