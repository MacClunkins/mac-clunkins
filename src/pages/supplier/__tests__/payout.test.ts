import { describe, expect, it } from 'vitest';
import { jobPayout } from '../logic';

const job = (over = {}) => ({ supplier_price_cents: 4375, quantity: 1000, birds_counted: null, status: 'accepted', ...over });

describe('what a job pays the supplier', () => {
  it('shows the full order value before pickup', () => {
    expect(jobPayout(job())).toEqual({ cents: 4_375_000, birds: 1000, collected: false, short: false });
  });

  it('pays for the birds counted at pickup, and flags a short load', () => {
    expect(jobPayout(job({ status: 'collected', birds_counted: 500 }))).toEqual({ cents: 2_187_500, birds: 500, collected: true, short: true });
  });

  it('a full pickup pays the whole order', () => {
    expect(jobPayout(job({ status: 'collected', birds_counted: 1000 }))).toMatchObject({ cents: 4_375_000, short: false, collected: true });
  });

  it('never pays for more birds than were ordered', () => {
    expect(jobPayout(job({ status: 'collected', birds_counted: 1200 })).cents).toBe(4_375_000);
  });

  it('a supplier count entered before pickup does not change the figure until it is collected', () => {
    expect(jobPayout(job({ status: 'ready', birds_counted: 500 })).cents).toBe(4_375_000);
  });
});
