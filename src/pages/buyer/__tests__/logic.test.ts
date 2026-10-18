import { describe, expect, it } from 'vitest';
import { birdsLineCents, formatCountdown, remainingMs } from '../lib/quote';
import { filterCounts, groupByMonth, paginate, searchOrders, yearTotals } from '../lib/orderFilters';
import type { OrderRow } from '../types';

const o = (over: Partial<OrderRow>): OrderRow => ({
  id: String(Math.random()), number: 'MC-1', bird_type: 'broiler', weight_band: '2_to_2_5kg', quantity: 10,
  total_cents: 100_00, status: 'delivered', delivery_date: null, placed_at: '2026-09-15T10:00:00', address_id: null, ...over,
});

describe('orders list logic', () => {
  const orders = [
    o({ number: 'MC-1', status: 'on_the_way' }),
    o({ number: 'MC-2', status: 'delivered', placed_at: '2026-09-02T10:00:00', total_cents: 200_00, quantity: 20 }),
    o({ number: 'MC-3', status: 'cancelled', placed_at: '2026-09-03T10:00:00', total_cents: 999_00 }),
    o({ number: 'MC-4', status: 'settled', placed_at: '2026-08-30T10:00:00', total_cents: 50_00 }),
  ];
  it('counts per chip', () => {
    expect(filterCounts(orders)).toEqual({ all: 4, in_progress: 1, delivered: 2, cancelled: 1 });
  });
  it('groups past orders by month, newest first, excluding cancelled from totals', () => {
    const g = groupByMonth(orders.filter((x) => x.status !== 'on_the_way'));
    expect(g.map((x) => x.key)).toEqual(['2026-09', '2026-08']);
    expect(g[0].totalCents).toBe(200_00);
    expect(g[1].totalCents).toBe(50_00);
  });
  it('searches by number, label and quantity', () => {
    const label = () => 'Broiler';
    expect(searchOrders(orders, 'mc-2', label)).toHaveLength(1);
    expect(searchOrders(orders, 'broil', label)).toHaveLength(4);
    expect(searchOrders(orders, '20', label)).toHaveLength(1);
  });
  it('pages and clamps', () => {
    const p = paginate([1, 2, 3, 4, 5], 9, 2);
    expect(p).toEqual({ items: [5], pages: 3, page: 3 });
  });
  it('year totals ignore cancelled money', () => {
    expect(yearTotals(orders, 2026).spentCents).toBe(100_00 + 200_00 + 50_00);
  });
});

describe('quote helpers', () => {
  it('formats the countdown', () => {
    expect(formatCountdown(30 * 60_000)).toBe('30:00');
    expect(formatCountdown(61_000)).toBe('01:01');
    // A priced request is held for a day: show hours instead of 1439 minutes.
    expect(formatCountdown(24 * 3_600_000)).toBe('24:00:00');
    expect(formatCountdown(3_600_000 + 5_000)).toBe('1:00:05');
    expect(formatCountdown(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatCountdown(-5)).toBe('00:00');
    expect(remainingMs('2026-01-01T00:00:00Z', Date.parse('2027-01-01'))).toBe(0);
  });
  it('reconciles the birds line whether the stored price is a line total or per bird', () => {
    const base = { quantity: 10, delivery_fee_cents: 50_00, service_fee_cents: 10_00 };
    expect(birdsLineCents({ ...base, bird_price_cents: 200_00, total_cents: 260_00 })).toBe(200_00);
    expect(birdsLineCents({ ...base, bird_price_cents: 20_00, total_cents: 260_00 })).toBe(200_00);
  });
});
