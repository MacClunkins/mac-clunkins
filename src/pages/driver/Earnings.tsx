import { DashboardShell } from '../../components/DashboardShell';
import { PageSpinner } from '../../components/PageSpinner';
import { FormError } from '../../components/FormField';
import { formatCents } from '../../lib/format';
import { useSupabaseQuery } from '../../lib/useQuery';
import { Card, Pill, Stat } from '../supplier-driver-shared/ui';
import { t } from '../supplier-driver-shared/t';
import { DriverNav } from './DriverNav';
import { listDriverTransfers, listTrips } from './data';
import { earningsByDay, pastTrips } from './earned';
import type { DriverTransfer, DriverTrip } from './types';

export default function DriverEarnings() {
  const trips = useSupabaseQuery<DriverTrip[]>(() => listTrips(), []);
  const transfers = useSupabaseQuery<DriverTransfer[]>(() => listDriverTransfers(), []);
  const days = earningsByDay(trips.data ?? [], new Date());
  const history = pastTrips(trips.data ?? []);
  const week = days.reduce((n, d) => n + d.cents, 0);
  const max = Math.max(1, ...days.map((d) => d.cents));

  return (
    <DashboardShell roleLabel={t('driver.role')}>
      <DriverNav />
      <h1 className="font-heading text-2xl font-bold">{t('driver.earn.title')}</h1>
      {(trips.loading || transfers.loading) && <PageSpinner label={t('common.loading')} />}
      {(trips.error || transfers.error) && <FormError message={(trips.error ?? transfers.error)?.message ?? null} />}
      <div className="mt-4"><Stat label={t('driver.earn.week_total')} value={formatCents(week)} tone="chilli" /></div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={t('driver.earn.by_day')}>
          <ul className="flex flex-col gap-2">
            {days.map((d) => (
              <li key={d.date.toISOString()} className="flex items-center gap-3 font-body text-sm">
                <span className="w-20 shrink-0">{d.date.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' })}</span>
                <span className="h-4 flex-1 rounded-full bg-cream">
                  <span className="block h-4 rounded-full bg-chilli" style={{ width: `${(d.cents / max) * 100}%` }} />
                </span>
                <span className="w-24 text-right font-semibold">{formatCents(d.cents)}</span>
                <span className="w-14 text-right text-ink/60">{t('driver.earn.trips', { count: d.trips })}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('driver.earn.history')}>
          {history.length === 0 && !trips.loading ? (
            <p className="font-body text-sm text-ink/60">{t('driver.earn.no_history')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-ink/10" data-testid="trip-history">
              {history.map((x) => (
                <li key={x.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-heading font-bold">{formatCents(x.driver_share_cents)}</p>
                    <p className="font-body text-xs text-ink/60">
                      {new Date(x.delivered_at ?? x.updated_at).toLocaleDateString('en-ZA')}
                      {x.delivered_count !== null ? ` · ${t('driver.earn.birds_delivered', { count: x.delivered_count })}` : ''}
                    </p>
                  </div>
                  <Pill tone={x.status === 'delivered' ? 'good' : 'bad'}>{t(`driver.status.${x.status}`)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('driver.earn.transfers')}>
          {(transfers.data ?? []).length === 0 ? (
            <p className="font-body text-sm text-ink/60">{t('driver.earn.no_transfers')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-ink/10">
              {(transfers.data ?? []).map((x) => (
                <li key={x.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-heading font-bold">{formatCents(x.amount_cents)}</p>
                    <p className="font-body text-xs text-ink/60">{new Date(x.created_at).toLocaleDateString('en-ZA')}</p>
                  </div>
                  <Pill tone={x.status === 'success' ? 'good' : x.status === 'failed' ? 'bad' : 'warn'}>{t(`transfer.${x.status}`)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
