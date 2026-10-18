import { loadOrderHistory } from './api';
import { actionLabel } from './AuditLog';
import { useAdminData } from './hooks/useAdminData';
import { describeChange, humanizeAction, mergeHistory, type HistoryEntry } from './logic/audit';
import type { OrderRow, AllocationRow, TripRow, PaymentRow, OrderEventRow } from './types';
import { t } from './i18n';
import { LoadState, Pill, SectionTitle, card, displayName, formatDateTime, tStatus } from './ui';

/** Everything recorded about this order in one list: status changes, who did what, payments, payouts, incidents. */
export function OrderHistory({ order, allocations, trips, payments, events }: {
  order: OrderRow; allocations: AllocationRow[]; trips: TripRow[]; payments: PaymentRow[]; events: OrderEventRow[];
}) {
  const key = [order.id, allocations.length, trips.length, payments.length, events.length].join(':');
  const { data, loading, error } = useAdminData(
    () => loadOrderHistory(order, allocations.map((a) => a.id), trips.map((x) => x.id), payments.map((p) => p.id)),
    [key],
  );
  const entries: HistoryEntry[] = mergeHistory([
    events.map((e) => ({ key: `e${e.id}`, at: e.created_at, who: e.actor?.full_name ?? t('admin.audit.system'), label: tStatus('order', e.status), detail: e.note ? [e.note] : [], source: 'event' as const })),
    (data?.audit ?? []).map((a) => ({ key: `a${a.id}`, at: a.created_at, who: a.actor ? displayName(a.actor) : t('admin.audit.system'), label: actionLabel(a.action), detail: describeChange(a.before, a.after), source: 'audit' as const })),
    (data?.incidents ?? []).map((i) => ({ key: `i${i.id}`, at: i.created_at, who: t('admin.audit.system'), label: `${i.number} · ${i.title}`, detail: [humanizeAction(i.kind)], source: 'incident' as const })),
  ]);
  return (
    <section className={card} data-testid="order-history">
      <SectionTitle>{t('admin.audit.orderHistory')}</SectionTitle>
      <LoadState loading={loading} error={error} hasData={!!data}>
        {entries.length === 0 ? <p className="font-body text-sm text-ink/60">{t('admin.audit.none')}</p> : (
          <ol className="flex flex-col gap-3 border-l-2 border-ink/10 pl-4">
            {entries.map((e) => (
              <li key={e.key} className="font-body text-sm">
                <Pill tone={e.source === 'incident' ? 'warn' : e.source === 'audit' ? 'neutral' : 'good'}>{e.label}</Pill>
                <span className="ml-2 text-xs text-ink/50">{formatDateTime(e.at)} - {e.who}</span>
                {e.detail.length > 0 && <p className="mt-1 text-ink/70">{e.detail.join(' · ')}</p>}
              </li>
            ))}
          </ol>
        )}
      </LoadState>
    </section>
  );
}
