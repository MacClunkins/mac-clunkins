import { describe, expect, it } from 'vitest';
import type { QuoteListRow } from '../api';
import { isReady, isWaitingForPrice, visibleQuotes } from '../lib/quoteList';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const row = (over: Partial<QuoteListRow>): QuoteListRow => ({
  id: 'q', bird_type: 'broiler', weight_band: '2_to_2_5kg', quantity: 400, total_cents: null, kind: 'requested',
  status: 'open', expires_at: null, created_at: '2026-10-18T10:00:00Z', ...over,
});

describe('quote list', () => {
  it('a requested quote with no price is waiting', () => {
    expect(isWaitingForPrice(row({}))).toBe(true);
    expect(isWaitingForPrice(row({ total_cents: 1000 }))).toBe(false);
    expect(isWaitingForPrice(row({ kind: 'instant' }))).toBe(false);
  });

  it('a priced quote is ready until it expires', () => {
    expect(isReady(row({ total_cents: 1000, expires_at: '2026-10-19T12:00:00Z' }), NOW)).toBe(true);
    expect(isReady(row({ total_cents: 1000, expires_at: '2026-10-18T11:59:00Z' }), NOW)).toBe(false);
    expect(isReady(row({}), NOW)).toBe(false);
  });

  it('shows waiting and ready quotes, hides expired, accepted and declined ones, newest first', () => {
    const rows = [
      row({ id: 'waiting', created_at: '2026-10-18T09:00:00Z' }),
      row({ id: 'ready', total_cents: 5000, expires_at: '2026-10-19T00:00:00Z', created_at: '2026-10-18T11:00:00Z' }),
      row({ id: 'expired', total_cents: 5000, expires_at: '2026-10-17T00:00:00Z' }),
      row({ id: 'accepted', total_cents: 5000, status: 'accepted' }),
      row({ id: 'declined', total_cents: 5000, status: 'declined' }),
    ];
    expect(visibleQuotes(rows, NOW).map((q) => q.id)).toEqual(['ready', 'waiting']);
  });
});
