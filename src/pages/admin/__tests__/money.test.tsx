// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin' }, signOut: vi.fn() }),
  roleHomePath: () => '/admin',
}));

import { formatCents } from '../../../lib/format';
import { computeBreakdown, estimatePaystackFeeCents, evaluateRematch, transferFeesCents } from '../logic/money';
import { birdsLineCents, orderMoney } from '../logic/orderMoney';
import { MoneyBreakdown } from '../MoneyBreakdown';

afterEach(cleanup);

// Order #MC-1053: 50 broilers, supplier R75, 38 km, card.
const order = { bird_price_cents: 431250, delivery_fee_cents: 50400, service_fee_cents: 16858, total_cents: 498508 };

describe('money from cents', () => {
  it('reproduces the worked example (R632.38 kept)', () => {
    expect(estimatePaystackFeeCents(498508, 'card')).toBe(16740);
    expect(transferFeesCents(2)).toBe(690);
    const m = orderMoney(order, [{ quantity: 50, supplier_price_cents: 7500 }], [{ driver_share_cents: 42840, driver_id: 'd1' }], []);
    expect(m.breakdown.buyerPaysCents).toBe(498508);
    expect(m.breakdown.supplierCostCents).toBe(375000);
    expect(m.breakdown.marginCents).toBe(63238);
    expect(m.feeEstimated).toBe(true);
    expect(m.incomplete).toBe(false);
  });

  it('renders every line formatted from cents, margin included', () => {
    const b = computeBreakdown({
      birdPriceCents: order.bird_price_cents, deliveryFeeCents: order.delivery_fee_cents, serviceFeeCents: order.service_fee_cents,
      supplierCostCents: 375000, driverShareCents: 42840, paystackFeeCents: 16740, transferCount: 2,
    });
    const { container } = render(<MemoryRouter><MoneyBreakdown order={order} breakdown={b} /></MemoryRouter>);
    const cents = [...container.querySelectorAll('[data-cents]')].map((n) => Number(n.getAttribute('data-cents')));
    expect(cents).toEqual([431250, 50400, 16858, 498508, 375000, 42840, 16740, 690, 63238]);
    const text = container.textContent ?? '';
    expect(text).toContain(formatCents(63238));
    expect(text).toContain(formatCents(498508));
    expect(b.marginPct).toBe(12.7);
  });
});

describe('an order stores the price per bird, the screen must still add up', () => {
  // MC-0001: 1000 birds at R51.75 each. bird_price_cents is the per-bird price, total is what was paid.
  const live = { bird_price_cents: 5175, delivery_fee_cents: 335200, service_fee_cents: 192857, total_cents: 5703057 };
  const manualPayment = [{ status: 'succeeded' as const, fee_cents: null, channel: null }];

  it('buyer pays the order total, not the per-bird price plus fees', () => {
    const m = orderMoney(live, [{ quantity: 1000, supplier_price_cents: 4375 }], [{ driver_share_cents: 284920, driver_id: 'd1' }], manualPayment);
    expect(m.breakdown.buyerPaysCents).toBe(5703057);
    expect(m.breakdown.supplierCostCents).toBe(4375000);
  });

  it('a manual payment has no Paystack fee, and says the fee is not an estimate', () => {
    const m = orderMoney(live, [{ quantity: 1000, supplier_price_cents: 4375 }], [{ driver_share_cents: 284920, driver_id: 'd1' }], manualPayment);
    expect(m.breakdown.paystackFeeCents).toBe(0);
    expect(m.feeEstimated).toBe(false);
  });

  it('McCluckin\'s keeps the markup, the service fee and the delivery difference', () => {
    const m = orderMoney(live, [{ quantity: 1000, supplier_price_cents: 4375 }], [{ driver_share_cents: 284920, driver_id: 'd1' }], manualPayment);
    // 5,703,057 - 4,375,000 - 284,920 - R6.90 transfer fees = R1,042,447 (R10,431.37 before transfer fees)
    expect(m.breakdown.marginCents).toBe(5703057 - 4375000 - 284920 - 690);
    expect(m.breakdown.marginCents).toBeGreaterThan(0);
  });

  it('a Paystack card payment still uses its recorded or estimated fee', () => {
    const card = [{ status: 'succeeded' as const, fee_cents: null, channel: 'card' as const }];
    const m = orderMoney(live, [{ quantity: 1000, supplier_price_cents: 4375 }], [], card);
    expect(m.feeEstimated).toBe(true);
    expect(m.breakdown.paystackFeeCents).toBeGreaterThan(0);
    const recorded = orderMoney(live, [{ quantity: 1000, supplier_price_cents: 4375 }], [], [{ status: 'succeeded' as const, fee_cents: 16746, channel: 'card' as const }]);
    expect(recorded.breakdown.paystackFeeCents).toBe(16746);
    expect(recorded.feeEstimated).toBe(false);
  });

  it('the birds line shown is total minus delivery minus service', () => {
    const b = computeBreakdown({ birdPriceCents: birdsLineCents(live), deliveryFeeCents: live.delivery_fee_cents, serviceFeeCents: live.service_fee_cents, supplierCostCents: 4375000, driverShareCents: 284920, paystackFeeCents: 0, transferCount: 2 });
    const { container } = render(<MemoryRouter><MoneyBreakdown order={live} breakdown={b} /></MemoryRouter>);
    const cents = [...container.querySelectorAll('[data-cents]')].map((n) => Number(n.getAttribute('data-cents')));
    expect(cents.slice(0, 4)).toEqual([5175000, 335200, 192857, 5703057]);
  });
});

describe('re-match rule', () => {
  const current = {
    birdPriceCents: 431250, deliveryFeeCents: 50400, serviceFeeCents: 16858,
    supplierCostCents: 375000, driverShareCents: 42840, paystackFeeCents: 16740, transferCount: 2,
  };
  it('cheaper supplier keeps the buyer price', () => {
    expect(evaluateRematch(current, { supplierCostCents: 350000, driverShareCents: 42840 }).outcome).toBe('cheaper_keep_price');
  });
  it('dearer supplier is absorbed while margin >= 0', () => {
    const r = evaluateRematch(current, { supplierCostCents: 430000, driverShareCents: 42840 });
    expect(r.outcome).toBe('absorb');
    expect(r.newMarginCents).toBeGreaterThanOrEqual(0);
  });
  it('full refund once margin would go negative', () => {
    const r = evaluateRematch(current, { supplierCostCents: 450000, driverShareCents: 42840 });
    expect(r.newMarginCents).toBeLessThan(0);
    expect(r.outcome).toBe('full_refund');
  });
});
