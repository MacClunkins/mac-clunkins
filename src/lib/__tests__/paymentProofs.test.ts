import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: {} }));

import { randsToCents } from '../paymentProofs';

describe('randsToCents', () => {
  it('turns rand amounts into cents', () => {
    expect(randsToCents('12.50')).toBe(1250);
    expect(randsToCents('12,5')).toBe(1250);
    expect(randsToCents('0')).toBe(0);
    expect(randsToCents(' 7 ')).toBe(700);
    expect(randsToCents('0.07')).toBe(7);
  });
  it('treats empty as no fee recorded', () => {
    expect(randsToCents('')).toBeNull();
    expect(randsToCents('   ')).toBeNull();
  });
  it('rejects anything that is not a plain amount', () => {
    for (const bad of ['twelve', '-5', '12.505', '1e3', '12.', 'R12']) expect(randsToCents(bad), bad).toBeUndefined();
  });
});
