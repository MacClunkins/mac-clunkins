import type { NameRef } from '../types';

export interface AuditRow {
  id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null;
  before: unknown; after: unknown; created_at: string; actor?: NameRef | null;
}

export interface HistoryEntry {
  key: string; at: string; who: string; label: string; detail: string[]; source: 'event' | 'audit' | 'incident';
}

/** "payment.proof_submitted" becomes "Payment proof submitted" when there is no written label. */
export function humanizeAction(action: string): string {
  const words = action.replace(/[._]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}

const show = (v: unknown): string => (v === null || v === undefined ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** What changed, as short lines: "status: queued to success". Works on the flat objects the audit log stores. */
export function describeChange(before: unknown, after: unknown, max = 8): string[] {
  const b = before && typeof before === 'object' ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === 'object' ? (after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const lines: string[] = [];
  for (const k of keys) {
    const had = k in b;
    const has = k in a;
    if (had && has && JSON.stringify(b[k]) === JSON.stringify(a[k])) continue;
    lines.push(had && has ? `${k}: ${show(b[k])} to ${show(a[k])}` : has ? `${k}: ${show(a[k])}` : `${k}: was ${show(b[k])}`);
    if (lines.length === max) break;
  }
  return lines;
}

/** One list from several sources, oldest first; entries with the same time keep the order they were given. */
export function mergeHistory(parts: HistoryEntry[][]): HistoryEntry[] {
  return parts
    .flat()
    .map((e, i) => ({ e, i }))
    .sort((x, y) => x.e.at.localeCompare(y.e.at) || x.i - y.i)
    .map((x) => x.e);
}
