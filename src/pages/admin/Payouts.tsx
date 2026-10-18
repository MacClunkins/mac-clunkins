import { useState } from 'react';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import { loadTransfers, retryTransfer } from './api';
import { PaidByEftForm, StatementsCard } from './PayoutEvidence';
import { useAdminData } from './hooks/useAdminData';
import { downloadCsv } from './logic/csv';
import { bankFileRows, canRetry } from './logic/payouts';
import type { TransferRow, TransferStatus } from './types';
import { t } from './i18n';
import { AdminLayout, DataTable, Empty, LoadState, Money, Pill, Tabs, card, displayName, errorText, formatDateTime, tStatus, useConfirm } from './ui';

type Tab = TransferStatus | 'all';
const STATUSES: TransferStatus[] = ['queued', 'sent', 'success', 'failed'];

export default function AdminPayouts() {
  const [tab, setTab] = useState<Tab>('all');
  const [msg, setMsg] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData(loadTransfers, []);
  const { ask, dialog } = useConfirm();
  const [payingId, setPayingId] = useState<string | null>(null);
  const all = data ?? [];
  const rows = tab === 'all' ? all : all.filter((r) => r.status === tab);
  const sum = (s: TransferStatus) => all.filter((r) => r.status === s).reduce((a, r) => a + r.amount_cents, 0);

  const retry = (r: TransferRow) => ask({
    title: t('admin.payouts.retryTitle'),
    body: <span>{t('admin.payouts.retryBody', { name: displayName(r.party) })} <Money cents={r.amount_cents} strong /></span>,
    confirmLabel: t('admin.payouts.retry'),
    run: async () => {
      const res = await retryTransfer(r);
      setMsg(errorText(res.error));
      if (!res.error) reload();
    },
  });

  return (
    <AdminLayout
      title={t('admin.payouts.title')}
      subtitle={t('admin.payouts.subtitle')}
      actions={<Button variant="secondary" onClick={() => downloadCsv('bank-file.csv', bankFileRows(all.filter((r) => r.status === 'failed' || r.status === 'queued')))}>{t('admin.payouts.bankFile')}</Button>}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUSES.map((s) => (
          <div key={s} className={card}>
            <p className="font-heading text-xl font-bold"><Money cents={sum(s)} /></p>
            <p className="font-body text-sm text-ink/60">{tStatus('transfer', s)} ({all.filter((r) => r.status === s).length})</p>
          </div>
        ))}
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'all', label: t('admin.common.all'), count: all.length }, ...STATUSES.map((s) => ({ value: s as Tab, label: tStatus('transfer', s), count: all.filter((r) => r.status === s).length }))]} />
      <div className="mt-4"><FormError message={msg} /></div>
      <LoadState loading={loading} error={error} hasData={!!data}>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty={<Empty title={t('admin.payouts.emptyTitle')} />}
          columns={[
            { key: 'p', header: t('admin.payouts.col.party'), render: (r) => displayName(r.party) },
            { key: 't', header: t('admin.payouts.col.type'), render: (r) => t(`admin.party.${r.party_type}`) },
            { key: 'a', header: t('admin.payouts.col.amount'), render: (r) => <Money cents={r.amount_cents} /> },
            { key: 's', header: t('admin.payouts.col.status'), render: (r) => <Pill tone={r.status === 'failed' ? 'bad' : r.status === 'success' ? 'good' : 'neutral'}>{tStatus('transfer', r.status)}</Pill> },
            { key: 'c', header: t('admin.payouts.col.code'), render: (r) => r.paystack_transfer_code ?? '-' },
            { key: 'f', header: t('admin.payouts.col.reason'), render: (r) => r.failure_reason ?? '-' },
            { key: 'd', header: t('admin.payouts.col.date'), render: (r) => formatDateTime(r.created_at) },
            { key: 'x', header: '', render: (r) => (
              <span className="flex gap-2">
                {canRetry(r.status) ? <Button variant="secondary" onClick={() => retry(r)}>{t('admin.payouts.retry')}</Button> : null}
                {r.status !== 'success' && r.status !== 'reversed' ? <Button variant="secondary" onClick={() => setPayingId(r.id)}>{t('admin.payouts.paidByEft')}</Button> : null}
              </span>
            ) },
          ]}
        />
      </LoadState>
      {payingId && (
        <PaidByEftForm
          transfer={all.find((x) => x.id === payingId)!}
          onClose={() => setPayingId(null)}
          onDone={() => { setPayingId(null); reload(); }}
        />
      )}
      <StatementsCard />
      <p className="mt-3 font-body text-xs text-ink/50">{t('admin.payouts.bankNote')}</p>
      {dialog}
    </AdminLayout>
  );
}
