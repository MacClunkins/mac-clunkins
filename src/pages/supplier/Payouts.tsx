import { useState } from 'react';
import { DashboardShell, EmptyState } from '../../components/DashboardShell';
import { PageSpinner } from '../../components/PageSpinner';
import { FormError, TextField } from '../../components/FormField';
import { Button } from '../../components/Button';
import { formatCents } from '../../lib/format';
import { useSupabaseQuery } from '../../lib/useQuery';
import { Card, Pill, Stat } from '../supplier-driver-shared/ui';
import { t } from '../supplier-driver-shared/t';
import { supabase } from '../../lib/supabase';
import { openProof } from '../../lib/paymentProofs';
import { SupplierNav } from './SupplierNav';
import { getBankMasked, listTransfers, saveBankDetails } from './data';
import type { BankMasked, SupplierTransfer } from './types';

export function statementCsv(rows: SupplierTransfer[]): string {
  const head = 'date,reference,amount_rands,status';
  const body = rows.map((r) => [r.created_at.slice(0, 10), r.id, (r.amount_cents / 100).toFixed(2), r.status].join(','));
  return [head, ...body].join('\n');
}

export default function SupplierPayouts() {
  const transfers = useSupabaseQuery<SupplierTransfer[]>(() => listTransfers(), []);
  const proofs = useSupabaseQuery<{ transfer_id: string; file_path: string; reference: string }[]>(
    () => supabase.from('transfer_proofs').select('transfer_id, file_path, reference'), [],
  );
  const proofOf = (id: string) => (proofs.data ?? []).find((p) => p.transfer_id === id);
  const [tick, setTick] = useState(0);
  const bank = useSupabaseQuery<BankMasked>(() => getBankMasked(), [tick]);
  const [form, setForm] = useState({ bank_name: '', account_holder: '', account_number: '', branch_code: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const rows = transfers.data ?? [];
  const paid = rows.filter((r) => r.status === 'success').reduce((n, r) => n + r.amount_cents, 0);
  const pending = rows.filter((r) => r.status === 'queued' || r.status === 'sent').reduce((n, r) => n + r.amount_cents, 0);

  async function save() {
    setMsg(null);
    if (!/^\d{6,16}$/.test(form.account_number) || !form.bank_name || !form.account_holder) {
      return setMsg(t('supplier.pay.bank_invalid'));
    }
    const { error } = await saveBankDetails(form);
    if (error) return setMsg(error.message);
    setForm({ bank_name: '', account_holder: '', account_number: '', branch_code: '' }); // never keep the number in state
    setEditing(false);
    setTick((n) => n + 1);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([statementCsv(rows)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mccluckins-statement.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const last4 = bank.data?.account_last4;

  return (
    <DashboardShell roleLabel={t('supplier.role')}>
      <SupplierNav />
      <h1 className="font-heading text-2xl font-bold">{t('supplier.pay.title')}</h1>
      <p className="mt-1 font-body text-sm text-ink/60">{t('supplier.pay.subtitle')}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label={t('supplier.pay.paid')} value={formatCents(paid)} />
        <Stat label={t('supplier.pay.pending')} value={formatCents(pending)} tone="chilli" />
      </div>
      {transfers.loading && <PageSpinner label={t('common.loading')} />}
      {transfers.error && <FormError message={transfers.error.message} />}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={t('supplier.pay.history')}>
          {rows.length === 0 && !transfers.loading ? (
            <EmptyState title={t('supplier.pay.empty_title')} body={t('supplier.pay.empty_body')} />
          ) : (
            <ul className="flex flex-col divide-y divide-ink/10">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-heading font-bold">{formatCents(r.amount_cents)}</p>
                    <p className="font-body text-xs text-ink/60">{new Date(r.created_at).toLocaleDateString('en-ZA')}</p>
                    {r.status === 'failed' && r.failure_reason && <p className="font-body text-xs text-chilli">{r.failure_reason}</p>}
                    {proofOf(r.id) && (
                      <p className="font-body text-xs text-ink/70">
                        {t('supplier.pay.reference', { ref: proofOf(r.id)?.reference ?? '' })}{' · '}
                        <button type="button" className="font-semibold text-chilli underline" onClick={() => void openProof(proofOf(r.id)?.file_path ?? '')}>{t('supplier.pay.proof')}</button>
                      </p>
                    )}
                  </div>
                  <Pill tone={r.status === 'success' ? 'good' : r.status === 'failed' ? 'bad' : 'warn'}>{t(`transfer.${r.status}`)}</Pill>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" className="mt-3 min-h-12 w-full" disabled={rows.length === 0} onClick={download}>
            {t('supplier.pay.statement')}
          </Button>
        </Card>

        <Card title={t('supplier.pay.bank_title')}>
          <FormError message={msg} />
          {!editing && (
            <div className="flex flex-col gap-3">
              <p className="font-body text-sm">
                {last4
                  ? t('supplier.pay.bank_masked', { bank: bank.data?.bank_name ?? '', last4 })
                  : t('supplier.pay.bank_none')}
              </p>
              <Button variant="secondary" className="min-h-12" onClick={() => setEditing(true)}>
                {last4 ? t('supplier.pay.bank_change') : t('supplier.pay.bank_add')}
              </Button>
            </div>
          )}
          {editing && (
            <div className="flex flex-col gap-3">
              <TextField id="bank" label={t('supplier.pay.bank_name')} value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
              <TextField id="holder" label={t('supplier.pay.account_holder')} value={form.account_holder} onChange={(e) => setForm({ ...form, account_holder: e.target.value })} />
              <TextField id="acct" label={t('supplier.pay.account_number')} inputMode="numeric" autoComplete="off" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
              <TextField id="branch" label={t('supplier.pay.branch_code')} inputMode="numeric" value={form.branch_code} onChange={(e) => setForm({ ...form, branch_code: e.target.value })} />
              <div className="flex gap-2">
                <Button className="min-h-12 flex-1" onClick={() => void save()}>{t('common.save')}</Button>
                <Button variant="secondary" className="min-h-12 flex-1" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
