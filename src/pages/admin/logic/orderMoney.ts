import type { AllocationRow, OrderRow, PaymentRow, TripRow } from '../types';
import { computeBreakdown, estimatePaystackFeeCents, type Breakdown, type BreakdownInput } from './money';

export interface OrderMoney {
  breakdown: Breakdown;
  /** Paystack fee was estimated (no recorded fee on the payment). */
  feeEstimated: boolean;
  /** No supplier allocation yet, so margin is not meaningful. */
  incomplete: boolean;
}

/** What the buyer paid for the birds themselves: total minus delivery minus service fee. */
export function birdsLineCents(order: Pick<OrderRow, 'delivery_fee_cents' | 'service_fee_cents' | 'total_cents'>): number {
  return order.total_cents - order.delivery_fee_cents - order.service_fee_cents;
}

export function breakdownInput(
  order: Pick<OrderRow, 'bird_price_cents' | 'delivery_fee_cents' | 'service_fee_cents' | 'total_cents'>,
  allocations: Pick<AllocationRow, 'quantity' | 'supplier_price_cents'>[],
  trips: Pick<TripRow, 'driver_share_cents' | 'driver_id'>[],
  payments: Pick<PaymentRow, 'status' | 'fee_cents' | 'channel'>[],
): { input: BreakdownInput; feeEstimated: boolean } {
  const paid = payments.filter((p) => p.status === 'succeeded' || p.status === 'refunded');
  // Paid by hand (EFT, cash, card machine): no Paystack channel and no fee were ever recorded, so there is
  // no gateway fee to subtract. Estimating a card fee here made manual orders look far less profitable.
  const manual = paid.length > 0 && paid.every((p) => p.channel === null && p.fee_cents === null);
  const recorded = manual || (paid.length > 0 && paid.every((p) => p.fee_cents !== null));
  const paystackFeeCents = manual
    ? 0
    : recorded
      ? paid.reduce((s, p) => s + (p.fee_cents ?? 0), 0)
      : estimatePaystackFeeCents(order.total_cents, paid[0]?.channel ?? 'card');
  const input: BreakdownInput = {
    // `orders.bird_price_cents` is the price PER BIRD, not the birds line. The line is whatever is left of
    // the total once delivery and the service fee are taken off, which always adds up to what was paid.
    birdPriceCents: birdsLineCents(order),
    deliveryFeeCents: order.delivery_fee_cents,
    serviceFeeCents: order.service_fee_cents,
    supplierCostCents: allocations.reduce((s, a) => s + a.quantity * a.supplier_price_cents, 0),
    driverShareCents: trips.reduce((s, t) => s + t.driver_share_cents, 0),
    paystackFeeCents,
    transferCount: allocations.length + trips.filter((t) => t.driver_id).length,
  };
  return { input, feeEstimated: !recorded };
}

export function orderMoney(
  order: Parameters<typeof breakdownInput>[0],
  allocations: Parameters<typeof breakdownInput>[1],
  trips: Parameters<typeof breakdownInput>[2],
  payments: Parameters<typeof breakdownInput>[3],
): OrderMoney {
  const { input, feeEstimated } = breakdownInput(order, allocations, trips, payments);
  return { breakdown: computeBreakdown(input), feeEstimated, incomplete: allocations.length === 0 };
}
