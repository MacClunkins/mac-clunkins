import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import {
  correctPickupCount, forceDelivery, loadIncidentEvents, loadIncidents, updateIncident,
  type IncidentRow,
} from './api';
import { useAdminData } from './hooks/useAdminData';
import { t } from './i18n';
import { AdminLayout, Empty, LoadState, Pill, Tabs, card, displayName, errorText, formatDateTime, input, useConfirm } from './ui';

type Tab = 'open' | 'in_review' | 'closed' | 'all';
const sevTone = (s: string) => (s === 'critical' ? 'bad' : s === 'warn' ? 'warn' : 'neutral') as 'bad' | 'warn' | 'neutral';
const statusTone = (s: string) => (s === 'resolved' ? 'good' : s === 'dismissed' ? 'neutral' : s === 'in_review' ? 'warn' : 'bad') as 'good' | 'neutral' | 'warn' | 'bad';
const COUNT_KINDS = ['short_load', 'count_mismatch', 'count_correction', 'crate_capacity'];

function dataLines(d: IncidentRow['data']): string[] {
  if (!d) return [];
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${t(`admin.incidents.data.${k}`) === `admin.incidents.data.${k}` ? k.replace(/_/g, ' ') : t(`admin.incidents.data.${k}`)}: ${String(v)}`);
}

export default function AdminIncidents() {
  const [tab, setTab] = useState<Tab>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData(loadIncidents, []);
  const all = data ?? [];
  const count = (f: (i: IncidentRow) => boolean) => all.filter(f).length;
  const rows = all.filter((i) => tab === 'all' || (tab === 'closed' ? i.status === 'resolved' || i.status === 'dismissed' : i.status === tab));

  return (
    <AdminLayout title={t('admin.incidents.title')} subtitle={t('admin.incidents.subtitle')}>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'open', label: t('admin.incidents.tabOpen'), count: count((i) => i.status === 'open') },
          { value: 'in_review', label: t('admin.incidents.tabReview'), count: count((i) => i.status === 'in_review') },
          { value: 'closed', label: t('admin.incidents.tabClosed'), count: count((i) => i.status === 'resolved' || i.status === 'dismissed') },
          { value: 'all', label: t('admin.common.all'), count: all.length },
        ]}
      />
      <LoadState loading={loading} error={error} hasData={!!data}>
        {rows.length === 0 ? <Empty title={t('admin.incidents.none')} /> : (
          <ul className="mt-3 flex flex-col gap-3">
            {rows.map((i) => (
              <li key={i.id} className={card} data-testid="incident-row">
                <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left font-body text-sm" onClick={() => setOpenId(openId === i.id ? null : i.id)} aria-expanded={openId === i.id}>
                  <span className="font-mono text-xs text-ink/60">{i.number}</span>
                  <span className="font-semibold">{i.title}</span>
                  <Pill tone={sevTone(i.severity)}>{t(`admin.incidents.severity.${i.severity}`)}</Pill>
                  <Pill tone={statusTone(i.status)}>{t(`admin.incidents.status.${i.status}`)}</Pill>
                  <span className="text-ink/60">{t(`admin.incidents.kind.${i.kind}`)}</span>
                  <span className="text-ink/60">{i.source === 'auto' ? t('admin.incidents.bySystem') : `${displayName(i.raiser)}${i.raised_role ? ` (${i.raised_role})` : ''}`}</span>
                  <span className="text-ink/60">{formatDateTime(i.created_at)}</span>
                </button>
                {openId === i.id && <IncidentPanel incident={i} onChanged={reload} />}
              </li>
            ))}
          </ul>
        )}
      </LoadState>
    </AdminLayout>
  );
}

function IncidentPanel({ incident: i, onChanged }: { incident: IncidentRow; onChanged: () => void }) {
  const events = useAdminData(() => loadIncidentEvents(i.id), [i.id]);
  const { ask, dialog } = useConfirm();
  const [note, setNote] = useState('');
  const [share, setShare] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ordered = typeof i.data?.ordered === 'number' ? (i.data.ordered as number) : undefined;
  const [count, setCount] = useState(ordered !== undefined ? String(ordered) : '');
  const [reason, setReason] = useState('');
  const closed = i.status === 'resolved' || i.status === 'dismissed';

  async function move(status: IncidentRow['status']) {
    setMsg(null);
    const r = await updateIncident(i.id, status, note, share);
    setMsg(errorText(r.error));
    if (!r.error) { setNote(''); events.reload(); onChanged(); }
  }

  const correct = () => ask({
    title: t('admin.incidents.correctTitle'),
    body: <span>{t('admin.incidents.correctBody', { count, reason })}</span>,
    confirmLabel: t('admin.incidents.correct'),
    run: async () => {
      const r = await correctPickupCount(i.allocation_id ?? '', Number(count), reason, i.id);
      setMsg(errorText(r.error));
      if (!r.error) { setReason(''); events.reload(); onChanged(); }
    },
  });

  const force = () => ask({
    title: t('admin.incidents.forceTitle'),
    body: <span>{t('admin.incidents.forceBody', { reason })}</span>,
    confirmLabel: t('admin.incidents.force'),
    destructive: true,
    run: async () => {
      const r = await forceDelivery(i.trip_id ?? '', null, reason);
      setMsg(errorText(r.error));
      if (!r.error) { setReason(''); events.reload(); onChanged(); }
    },
  });

  return (
    <div className="mt-4 border-t border-ink/10 pt-4 font-body text-sm">
      {i.details && <p className="whitespace-pre-wrap">{i.details}</p>}
      {dataLines(i.data).length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-ink/70" data-testid="incident-data">
          {dataLines(i.data).map((l) => (<li key={l}>{l}</li>))}
        </ul>
      )}
      {i.order_id && <p className="mt-2"><Link className="font-semibold text-chilli underline" to={`/admin/orders/${i.order_id}`}>{t('admin.incidents.openOrder', { number: i.order_number ?? '' })}</Link></p>}
      {closed && i.resolution_note && <p className="mt-2 rounded-lg bg-green-50 px-3 py-2">{t('admin.incidents.resolution')}: {i.resolution_note}</p>}

      <h3 className="mt-4 font-heading font-bold">{t('admin.incidents.history')}</h3>
      <LoadState loading={events.loading} error={events.error} hasData={!!events.data}>
        {(events.data ?? []).length === 0 ? <p className="text-ink/60">{t('admin.incidents.noEvents')}</p> : (
          <ul className="mt-1 flex flex-col gap-1">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="rounded-lg bg-cream px-3 py-2">
                <span className="text-xs text-ink/60">{formatDateTime(e.created_at)} · {displayName(e.actor)}{e.visible_to_raiser ? ` · ${t('admin.incidents.shared')}` : ''}</span>
                <br />{e.body}
              </li>
            ))}
          </ul>
        )}
      </LoadState>

      <FormError message={msg} />
      <label className="mt-4 flex flex-col gap-1">
        {t('admin.incidents.note')}
        <textarea className={input} rows={2} aria-label={t('admin.incidents.note')} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        {t('admin.incidents.share')}
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {!closed && i.status !== 'in_review' && <Button variant="secondary" onClick={() => void move('in_review')}>{t('admin.incidents.startReview')}</Button>}
        {!closed && <Button onClick={() => void move('resolved')}>{t('admin.incidents.resolve')}</Button>}
        {!closed && <Button variant="secondary" onClick={() => void move('dismissed')}>{t('admin.incidents.dismiss')}</Button>}
        {closed && <Button variant="secondary" onClick={() => void move('open')}>{t('admin.incidents.reopen')}</Button>}
        {note.trim() && <Button variant="secondary" onClick={() => void move(i.status)}>{t('admin.incidents.addNote')}</Button>}
      </div>

      {(i.allocation_id && COUNT_KINDS.includes(i.kind)) || i.trip_id ? (
        <div className="mt-5 rounded-xl border border-ink/10 p-3">
          <h3 className="font-heading font-bold">{t('admin.incidents.fixes')}</h3>
          <label className="mt-2 flex flex-col gap-1">
            {t('admin.incidents.reason')}
            <input className={input} aria-label={t('admin.incidents.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            {i.allocation_id && COUNT_KINDS.includes(i.kind) && (
              <>
                <label className="flex flex-col gap-1">
                  {t('admin.incidents.newCount')}
                  <input className={`${input} w-28`} inputMode="numeric" aria-label={t('admin.incidents.newCount')} value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
                </label>
                <Button variant="secondary" disabled={!count || reason.trim().length < 5} onClick={correct}>{t('admin.incidents.correct')}</Button>
              </>
            )}
            {i.trip_id && i.kind !== 'delivery_override' && (
              <Button variant="secondary" disabled={reason.trim().length < 5} onClick={force}>{t('admin.incidents.force')}</Button>
            )}
          </div>
          <p className="mt-2 text-xs text-ink/60">{t('admin.incidents.fixesHelp')}</p>
        </div>
      ) : null}
      {dialog}
    </div>
  );
}
