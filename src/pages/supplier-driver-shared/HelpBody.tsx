import { useState } from 'react';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import { useSupabaseQuery } from '../../lib/useQuery';
import { supabase } from '../../lib/supabase';
import { friendlyError } from './errors';
import { t } from './t';
import { Card, Pill } from './ui';

export type HelpRole = 'supplier' | 'driver';
export const HELP_KINDS = ['short_load', 'crate_capacity', 'count_correction', 'vehicle', 'access', 'payout_question', 'other'] as const;
type Kind = (typeof HELP_KINDS)[number];

interface Job { id: string; created_at: string; quantity?: number; status: string }
interface Incident { id: string; number: string; kind: string; status: string; title: string; created_at: string; resolution_note: string | null }
interface Note { incident_id: string; body: string; created_at: string }

const tone = (s: string) => (s === 'resolved' ? 'good' : s === 'dismissed' ? 'neutral' : s === 'in_review' ? 'warn' : 'bad');

/** "Report a problem" for suppliers and drivers, and the status of what they already reported. */
export function HelpBody({ role }: { role: HelpRole }) {
  const [tick, setTick] = useState(0);
  const [kind, setKind] = useState<Kind>('other');
  const [jobId, setJobId] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // Suppliers pick one of their jobs, drivers one of their trips. Row-level security limits both to their own.
  const jobs = useSupabaseQuery<Job[]>(
    () => role === 'supplier'
      ? supabase.from('supplier_allocations').select('id, created_at, quantity, status').order('created_at', { ascending: false }).limit(30)
      : supabase.from('driver_trips').select('id, created_at, status').order('created_at', { ascending: false }).limit(30),
    [role],
  );
  const incidents = useSupabaseQuery<Incident[]>(
    () => supabase.from('incidents').select('id, number, kind, status, title, created_at, resolution_note').order('created_at', { ascending: false }).limit(50),
    [tick],
  );
  const notes = useSupabaseQuery<Note[]>(
    () => supabase.from('incident_events').select('incident_id, body, created_at').order('created_at'),
    [tick],
  );

  async function submit() {
    setMsg(null);
    setSent(null);
    if (title.trim().length < 3) return setMsg(t('help.need_title'));
    setBusy(true);
    const { error } = await supabase.rpc('raise_incident', {
      p_kind: kind,
      p_allocation_id: role === 'supplier' && jobId ? jobId : null,
      p_trip_id: role === 'driver' && jobId ? jobId : null,
      p_title: title.trim(),
      p_details: details.trim() || null,
    });
    setBusy(false);
    if (error) return setMsg(friendlyError(error.message));
    setTitle('');
    setDetails('');
    setJobId('');
    setSent(t('help.sent'));
    setTick((n) => n + 1);
  }

  const label = (j: Job, i: number) =>
    `${new Date(j.created_at).toLocaleDateString('en-ZA')} · ${j.quantity != null ? t('supplier.jobs.birds', { count: j.quantity }) : t(`driver.status.${j.status}`)} · #${i + 1}`;

  return (
    <>
      <h1 className="font-heading text-2xl font-bold">{t('help.title')}</h1>
      <p className="mt-1 font-body text-sm text-ink/60">{t('help.subtitle')}</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={t('help.new')}>
          <div className="flex flex-col gap-3 font-body text-sm">
            <label className="flex flex-col gap-1">
              {t('help.kind')}
              <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label={t('help.kind')} className="min-h-12 rounded-xl border border-ink/20 bg-white px-3">
                {HELP_KINDS.map((k) => (<option key={k} value={k}>{t(`help.kinds.${k}`)}</option>))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t('help.job')}
              <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label={t('help.job')} className="min-h-12 rounded-xl border border-ink/20 bg-white px-3">
                <option value="">{t('help.no_job')}</option>
                {(jobs.data ?? []).map((j, i) => (<option key={j.id} value={j.id}>{label(j, i)}</option>))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t('help.what')}
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label={t('help.what')} className="min-h-12 rounded-xl border border-ink/20 bg-white px-3" />
            </label>
            <label className="flex flex-col gap-1">
              {t('help.details')}
              <textarea value={details} maxLength={2000} rows={4} onChange={(e) => setDetails(e.target.value)} aria-label={t('help.details')} className="rounded-xl border border-ink/20 bg-white px-3 py-2" />
            </label>
            <FormError message={msg} />
            {sent && <p role="status" className="rounded-lg bg-green-100 px-3 py-2 text-green-800">{sent}</p>}
            <Button className="min-h-12" disabled={busy} onClick={() => void submit()}>{t('help.send')}</Button>
          </div>
        </Card>
        <Card title={t('help.yours')}>
          {(incidents.data ?? []).length === 0 ? (
            <p className="font-body text-sm text-ink/60">{incidents.loading ? t('common.loading') : t('help.none')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-ink/10" data-testid="my-reports">
              {(incidents.data ?? []).map((i) => (
                <li key={i.id} className="py-3 font-body text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-heading font-bold">{i.number} · {i.title}</p>
                    <Pill tone={tone(i.status)}>{t(`help.status.${i.status}`)}</Pill>
                  </div>
                  <p className="text-xs text-ink/60">{new Date(i.created_at).toLocaleDateString('en-ZA')}</p>
                  {(notes.data ?? []).filter((n) => n.incident_id === i.id).map((n) => (
                    <p key={n.created_at + n.body} className="mt-1 rounded-lg bg-cream px-3 py-2">{n.body}</p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
