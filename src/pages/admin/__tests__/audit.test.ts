import { describe, expect, it } from 'vitest';
import { describeChange, humanizeAction, mergeHistory, type HistoryEntry } from '../logic/audit';

describe('humanizeAction', () => {
  it('makes an action readable when there is no written label', () => {
    expect(humanizeAction('payment.proof_submitted')).toBe('Payment proof submitted');
    expect(humanizeAction('admin.force_delivery')).toBe('Admin force delivery');
    expect(humanizeAction('')).toBe('');
  });
});

describe('describeChange', () => {
  it('lists what changed, and leaves out what did not', () => {
    expect(describeChange({ status: 'queued', amount_cents: 100 }, { status: 'success', amount_cents: 100, reference: 'FNB-1' }))
      .toEqual(['status: queued to success', 'reference: FNB-1']);
  });
  it('shows nested values as json and handles missing sides', () => {
    expect(describeChange(null, { value: { a: 1 } })).toEqual(['value: {"a":1}']);
    expect(describeChange({ was: 5 }, null)).toEqual(['was: was 5']);
    expect(describeChange(null, null)).toEqual([]);
    expect(describeChange({ x: null }, { x: 4 })).toEqual(['x: none to 4']);
  });
  it('caps the list', () => {
    const after = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    expect(describeChange({}, after, 5)).toHaveLength(5);
  });
});

describe('mergeHistory', () => {
  const e = (key: string, at: string): HistoryEntry => ({ key, at, who: 'x', label: key, detail: [], source: 'audit' });
  it('orders several sources oldest first and keeps ties in the order given', () => {
    const merged = mergeHistory([
      [e('a2', '2026-10-18T10:00:00Z'), e('a1', '2026-10-18T08:00:00Z')],
      [e('b1', '2026-10-18T09:00:00Z'), e('tie-b', '2026-10-18T10:00:00Z')],
    ]);
    expect(merged.map((m) => m.key)).toEqual(['a1', 'b1', 'a2', 'tie-b']);
  });
  it('is empty for no sources', () => {
    expect(mergeHistory([])).toEqual([]);
  });
});
