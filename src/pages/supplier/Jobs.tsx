import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardShell, EmptyState } from '../../components/DashboardShell';
import { PageSpinner } from '../../components/PageSpinner';
import { FormError } from '../../components/FormField';
import { Button } from '../../components/Button';
import { formatCents } from '../../lib/format';
import { useSupabaseQuery } from '../../lib/useQuery';
import { Pill, Stat, Tabs } from '../supplier-driver-shared/ui';
import { t } from '../supplier-driver-shared/t';
import { SupplierNav } from './SupplierNav';
import { approvalState, jobPayout, tabForStatus, weekStartISO, type JobTab } from './logic';
import { getSupplierDetails, listAllocations, listDocuments, listStock, respondToAllocation } from './data';
import type { ComplianceDoc, StockRow, SupplierAllocation, SupplierDetails } from './types';

export default function SupplierJobs() {
  const [tab, setTab] = useState<JobTab>('new');
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = new Date();
  const weeks = [weekStartISO(now), weekStartISO(now, 1)];

  const jobs = useSupabaseQuery<SupplierAllocation[]>(() => listAllocations(), [tick]);
  const stock = useSupabaseQuery<StockRow[]>(() => listStock(weeks), []);
  const docs = useSupabaseQuery<ComplianceDoc[]>(() => listDocuments(), []);
  const details = useSupabaseQuery<SupplierDetails>(() => getSupplierDetails(), []);

  const loading = jobs.loading || docs.loading || details.loading;
  const approval = approvalState(docs.data ?? []);
  const blocked = approval !== 'approved' || details.data?.paused === true;

  async function respond(id: string, accept: boolean) {
    setActionError(null);
    const { error } = await respondToAllocation(id, accept);
    if (error) setActionError(error.message);
    else setTick((n) => n + 1);
  }

  const visible = (jobs.data ?? []).filter((j) => tabForStatus(j.status) === tab);
  const counts = (['new', 'active', 'done'] as JobTab[]).reduce(
    (acc, k) => ({ ...acc, [k]: (jobs.data ?? []).filter((j) => tabForStatus(j.status) === k).length }),
    {} as Record<JobTab, number>,
  );
  const thisWeekBirds = (stock.data ?? []).filter((s) => s.week_start === weeks[0]).reduce((n, s) => n + s.birds_available, 0);
  const nextWeekBirds = (stock.data ?? []).filter((s) => s.week_start === weeks[1]).reduce((n, s) => n + s.birds_available, 0);

  return (
    <DashboardShell roleLabel={t('supplier.role')}>
      <SupplierNav />
      <h1 className="font-heading text-2xl font-bold">{t('supplier.jobs.title')}</h1>
      <p className="mt-1 font-body text-sm text-ink/60">{t('supplier.jobs.subtitle')}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t('supplier.jobs.stock_this_week')} value={String(thisWeekBirds)} />
        <Stat label={t('supplier.jobs.stock_next_week')} value={String(nextWeekBirds)} />
        <Stat label={t('supplier.jobs.new_count')} value={String(counts.new)} tone="chilli" />
      </div>

      {loading && <PageSpinner label={t('supplier.jobs.loading')} />}
      {jobs.error && <FormError message={t('supplier.jobs.load_error', { message: jobs.error.message })} />}
      <FormError message={actionError} />

      {!loading && blocked && (
        <div className="mt-6 rounded-2xl bg-mustard/30 p-4 font-body text-sm" role="status">
          <p className="font-semibold">{t(`supplier.jobs.blocked.${approval}`)}</p>
          <Link to="/supplier/onboarding" className="mt-2 inline-flex min-h-12 items-center font-semibold text-chilli underline">
            {t('supplier.jobs.go_onboarding')}
          </Link>
        </div>
      )}

      {!loading && !blocked && (
        <div className="mt-6 flex flex-col gap-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'new', label: t('supplier.jobs.tab_new'), count: counts.new },
              { id: 'active', label: t('supplier.jobs.tab_active'), count: counts.active },
              { id: 'done', label: t('supplier.jobs.tab_done'), count: counts.done },
            ]}
          />
          {visible.length === 0 && <EmptyState title={t('supplier.jobs.empty_title')} body={t(`supplier.jobs.empty_${tab}`)} />}
          <ul className="flex flex-col gap-3">
            {visible.map((job) => (
              <li key={job.id} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-heading text-lg font-bold">{t('supplier.jobs.birds', { count: job.quantity })}</p>
                    <p className="font-body text-sm text-ink/60">
                      {job.pickup_at
                        ? t('supplier.jobs.pickup', { when: new Date(job.pickup_at).toLocaleString('en-ZA') })
                        : t('supplier.jobs.pickup_unset')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-heading text-lg font-bold">{formatCents(jobPayout(job).cents)}</p>
                    <p className="font-body text-xs text-ink/60" data-testid="job-payout-note">
                      {jobPayout(job).short
                        ? t('supplier.jobs.short_pickup', { counted: jobPayout(job).birds, ordered: job.quantity })
                        : jobPayout(job).collected
                          ? t('supplier.jobs.payout_collected', { count: jobPayout(job).birds })
                          : t('supplier.jobs.payout_note')}
                    </p>
                    <Pill tone={job.status === 'ready' ? 'good' : 'neutral'}>{t(`supplier.status.${job.status}`)}</Pill>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {job.status === 'offered' ? (
                    <>
                      <Button className="min-h-12 flex-1" onClick={() => void respond(job.id, true)}>
                        {t('supplier.jobs.accept')}
                      </Button>
                      <Button variant="secondary" className="min-h-12 flex-1" onClick={() => void respond(job.id, false)}>
                        {t('supplier.jobs.decline')}
                      </Button>
                    </>
                  ) : (
                    <Link
                      to={`/supplier/jobs/${job.id}`}
                      className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full border border-ink/20 font-body font-semibold"
                    >
                      {t('supplier.jobs.open')}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardShell>
  );
}
