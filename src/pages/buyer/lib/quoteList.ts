import type { QuoteListRow } from '../api';

/** A requested quote that an admin has not priced yet. */
export const isWaitingForPrice = (q: QuoteListRow) => q.kind === 'requested' && q.total_cents === null;

/** A priced quote the buyer can still act on. */
export const isReady = (q: QuoteListRow, now = Date.now()) =>
  q.total_cents !== null && (!q.expires_at || new Date(q.expires_at).getTime() > now);

/** Quotes worth showing on the orders page: waiting for a price, or priced and not expired. */
export function visibleQuotes(rows: QuoteListRow[], now = Date.now()): QuoteListRow[] {
  return rows
    .filter((q) => q.status === 'open' && (isWaitingForPrice(q) || isReady(q, now)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
