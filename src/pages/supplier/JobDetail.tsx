import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DashboardShell } from '../../components/DashboardShell';
import { PageSpinner } from '../../components/PageSpinner';
import { FormError } from '../../components/FormField';
import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthContext';
import { useSupabaseQuery } from '../../lib/useQuery';
import { Card, Check, FileField, NumberField, Pill } from '../supplier-driver-shared/ui';
import { uploadFile } from '../supplier-driver-shared/storage';
import { t } from '../supplier-driver-shared/t';
import { SupplierNav } from './SupplierNav';
import { formatCountdown, permitValidUntil, usePermitCountdown, PERMIT_WINDOW_HOURS } from './permit';
import { readyBlockers } from './logic';
import { friendlyError } from '../supplier-driver-shared/errors';
import { getAllocation, markAllocationReady, saveAllocationProgress } from './data';
import type { SupplierAllocation } from './types';

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SupplierJobDetail() {
  const { id = '' } = useParams();
  const { profile } = useAuth();
  const [tick, setTick] = useState(0);
  const { data: job, loading, error } = useSupabaseQuery<SupplierAllocation>(() => getAllocation(id), [id, tick]);
  const [counted, setCounted] = useState('');
  const [crates, setCrates] = useState('');
  const [welfare, setWelfare] = useState(false);
  const [signedAt, setSignedAt] = useState(toLocalInput(new Date()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const countdown = usePermitCountdown(job?.permit_valid_until);

  useEffect(() => {
    if (!job) return;
    setCounted(job.birds_counted?.toString() ?? '');
    setCrates(job.crates?.toString() ?? '');
    setWelfare(job.welfare_ok ?? false);
  }, [job]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setMsg(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) setMsg(friendlyError(e.message));
    else setTick((n) => n + 1);
  }

  const saveCounts = () =>
    run(() =>
      saveAllocationProgress(id, {
        birds_counted: Number(counted) || 0,
        crates: Number(crates) || 0,
        welfare_ok: welfare,
      }),
    );

  async function uploadPhoto(file: File) {
    if (!profile) return;
    await run(async () => {
      const up = await uploadFile(file, profile.id, 'load');
      if (!up.path) return { error: { message: up.error ?? 'upload' } };
      return saveAllocationProgress(id, { load_photo_path: up.path });
    });
  }

  async function uploadPermit(file: File) {
    if (!profile) return;
    await run(async () => {
      const up = await uploadFile(file, profile.id, 'permits');
      if (!up.path) return { error: { message: up.error ?? 'upload' } };
      return saveAllocationProgress(id, {
        removal_permit_path: up.path,
        permit_valid_until: permitValidUntil(new Date(signedAt)).toISOString(),
      });
    });
  }

  const blockers = job ? readyBlockers(job) : [];
  const canEdit = job?.status === 'accepted';

  return (
    <DashboardShell roleLabel={t('supplier.role')}>
      <SupplierNav />
      <Link to="/supplier/jobs" className="font-body text-sm font-semibold text-chilli underline">
        {t('supplier.job.back')}
      </Link>
      {loading && <PageSpinner label={t('supplier.job.loading')} />}
      {error && <FormError message={error.message} />}
      {job && (
        <>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-heading text-2xl font-bold">{t('supplier.job.title', { count: job.quantity })}</h1>
            <Pill tone={job.status === 'ready' ? 'good' : 'neutral'}>{t(`supplier.status.${job.status}`)}</Pill>
          </div>
          <p className="mt-1 font-body text-sm text-ink/60">{t('supplier.job.no_buyer')}</p>
          <FormError message={msg} />
          {job.status === 'ready' && (
            <p className="mt-2 rounded-xl bg-mustard/25 px-4 py-2 font-body text-sm" data-testid="job-locked">
              {t('supplier.job.locked_help')} <Link to="/supplier/help" className="font-semibold underline">{t('supplier.nav.help')}</Link>
            </p>
          )}

          {/* Tablet loading area: two panels from lg up, stacked on a phone. */}
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Card title={t('supplier.job.count_title')}>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField id="counted" label={t('supplier.job.birds_counted')} value={counted} onChange={setCounted} />
                  <NumberField id="crates" label={t('supplier.job.crates')} value={crates} onChange={setCrates} />
                </div>
                <div className="mt-3">
                  <Check id="welfare" label={t('supplier.job.welfare')} checked={welfare} onChange={setWelfare} />
                </div>
                <Button className="mt-3 min-h-12 w-full" disabled={busy || !canEdit} onClick={() => void saveCounts()}>
                  {t('supplier.job.save_counts')}
                </Button>
              </Card>
              <Card title={t('supplier.job.photo_title')}>
                <FileField
                  label={t('supplier.job.load_photo')}
                  capture="environment"
                  done={!!job.load_photo_path}
                  disabled={busy || !canEdit}
                  onFile={(f) => void uploadPhoto(f)}
                />
              </Card>
            </div>

            <div className="flex flex-col gap-4">
              <Card title={t('supplier.job.permit_title')}>
                <p className="font-body text-sm text-ink/70">{t('supplier.job.permit_help', { hours: PERMIT_WINDOW_HOURS })}</p>
                {countdown && (
                  <div
                    role="timer"
                    aria-live="off"
                    data-testid="permit-countdown"
                    className={`my-3 rounded-xl p-4 text-center ${
                      countdown.urgency === 'expired' ? 'bg-chilli/15 text-chilli' : countdown.urgency === 'warn' ? 'bg-mustard/40' : 'bg-green-100 text-green-900'
                    }`}
                  >
                    <p className="font-body text-xs uppercase tracking-wide">
                      {countdown.expired ? t('supplier.job.permit_expired') : t('supplier.job.permit_remaining')}
                    </p>
                    <p className="font-heading text-4xl font-bold tabular-nums">{formatCountdown(countdown)}</p>
                  </div>
                )}
                <label className="mb-3 flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink/80">{t('supplier.job.signed_at')}</span>
                  <input
                    type="datetime-local"
                    value={signedAt}
                    onChange={(e) => setSignedAt(e.target.value)}
                    className="min-h-12 rounded-lg border border-ink/15 bg-white px-3"
                  />
                </label>
                <FileField
                  label={t('supplier.job.permit_upload')}
                  accept="image/*,application/pdf"
                  done={!!job.removal_permit_path}
                  disabled={busy || !canEdit}
                  onFile={(f) => void uploadPermit(f)}
                />
              </Card>
              <Card title={t('supplier.job.ready_title')}>
                {blockers.length > 0 && (
                  <ul className="mb-3 list-disc pl-5 font-body text-sm text-ink/70">
                    {blockers.map((k) => (
                      <li key={k}>{t(k)}</li>
                    ))}
                  </ul>
                )}
                <Button
                  className="min-h-14 w-full text-lg"
                  disabled={busy || !canEdit || blockers.length > 0}
                  onClick={() => void run(() => markAllocationReady(id))}
                >
                  {t('supplier.job.mark_ready')}
                </Button>
              </Card>
            </div>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
