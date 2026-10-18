import { describe, expect, it } from 'vitest';
import { checkOrderMoney, HIGH_MARGIN_PCT, sortChecks, summarize, type MoneyCheckInput } from '../logic/moneyCheck';

// MC-0001: 1000 birds at R43.75 from the supplier, buyer paid R57,030.57, driver share R2,849.20.
const base = (over: Partial<MoneyCheckInput> = {}): MoneyCheckInput => ({
  order: { id: 'o1', number: 'MC-0001', status: 'delivered', total_cents: 5703057 },
  allocations: [{ id: 'a1', quantity: 1000, supplier_price_cents: 4375, birds_counted: 1000, status: 'collected' }],
  trips: [{ id: 't1', driver_share_cents: 284920, status: 'delivered' }],
  payments: [{ status: 'succeeded', amount_cents: 5703057, fee_cents: null }],
  transfers: [{ party_type: 'supplier', amount_cents: 4375000, status: 'queued' }, { party_type: 'driver', amount_cents: 284920, status: 'queued' }],
  payoutFeesCents: 0,
  ...over,
});

describe('money check', () => {
  it('an order that adds up has no flags and a normal margin', () => {
    const c = checkOrderMoney(base());
    expect(c.flags).toEqual([]);
    expect(c.marginCents).toBe(5703057 - 4375000 - 284920);
    expect(c.marginPct).toBeGreaterThan(15);
    expect(c.marginPct).toBeLessThan(HIGH_MARGIN_PCT);
  });

  it('the half-paid supplier from the live test is caught: short load and a margin that is too high', () => {
    const c = checkOrderMoney(base({
      allocations: [{ id: 'a1', quantity: 1000, supplier_price_cents: 4375, birds_counted: 500, status: 'collected' }],
      transfers: [{ party_type: 'supplier', amount_cents: 2187500, status: 'queued' }, { party_type: 'driver', amount_cents: 284920, status: 'queued' }],
    }));
    expect(c.flags).toContain('short_load');
    expect(c.flags).toContain('margin_high');
    expect(c.flags).not.toContain('supplier_mismatch');
    expect(c.marginCents).toBe(5703057 - 2187500 - 284920);
  });

  it('a supplier payout that is not price times birds collected is a mismatch', () => {
    const c = checkOrderMoney(base({ transfers: [{ party_type: 'supplier', amount_cents: 2000000, status: 'queued' }, { party_type: 'driver', amount_cents: 284920, status: 'queued' }] }));
    expect(c.flags).toContain('supplier_mismatch');
  });

  it('collected birds with no supplier payout, and a driver payout that is wrong', () => {
    const none = checkOrderMoney(base({ transfers: [{ party_type: 'driver', amount_cents: 284920, status: 'queued' }] }));
    expect(none.flags).toContain('missing_supplier_payout');
    const driver = checkOrderMoney(base({ transfers: [{ party_type: 'supplier', amount_cents: 4375000, status: 'queued' }, { party_type: 'driver', amount_cents: 100, status: 'queued' }] }));
    expect(driver.flags).toContain('driver_mismatch');
  });

  it('losing money, delivered but unpaid, and paid out before the buyer paid', () => {
    expect(checkOrderMoney(base({ payments: [{ status: 'succeeded', amount_cents: 5703057, fee_cents: 2000000 }] })).flags).toContain('negative_margin');
    const unpaid = checkOrderMoney(base({ payments: [{ status: 'pending', amount_cents: 5703057, fee_cents: null }] }));
    expect(unpaid.flags).toEqual(expect.arrayContaining(['unpaid_delivered', 'payout_before_payment']));
    expect(unpaid.marginCents).toBe(0 - 4375000 - 284920);
  });

  it('failed and reversed payouts do not count as money paid out; bank fees reduce the margin', () => {
    const c = checkOrderMoney(base({
      transfers: [{ party_type: 'supplier', amount_cents: 4375000, status: 'failed' }, { party_type: 'supplier', amount_cents: 4375000, status: 'success' }, { party_type: 'driver', amount_cents: 284920, status: 'reversed' }],
      payments: [{ status: 'succeeded', amount_cents: 5703057, fee_cents: 1250 }], payoutFeesCents: 350,
    }));
    expect(c.supplierPayoutCents).toBe(4375000);
    expect(c.driverPayoutCents).toBe(0);
    expect(c.bankFeesCents).toBe(1600);
  });

  it('an order with nothing collected yet is not flagged, and sorting puts flagged orders first', () => {
    const idle = checkOrderMoney(base({ order: { id: 'o2', number: 'MC-0002', status: 'paid', total_cents: 100 }, allocations: [{ id: 'a2', quantity: 10, supplier_price_cents: 100, birds_counted: null, status: 'offered' }], trips: [], transfers: [], payments: [{ status: 'succeeded', amount_cents: 100, fee_cents: null }] }));
    expect(idle.flags).toEqual([]);   // nothing collected or paid out yet, so keeping the whole payment is expected
    const bad = checkOrderMoney(base({ transfers: [] }));
    expect(sortChecks([idle, bad])[0]).toBe(bad);
    expect(summarize([idle, bad])).toMatchObject({ orders: 2, flagged: 1 });
  });
});
