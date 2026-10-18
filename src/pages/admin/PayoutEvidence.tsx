import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { addBankStatement, listBankStatements, markTransferPaid, openProof, randsToCents, type StatementRow } from '../../lib/paymentProofs';
import type { TransferRow } from './types';
import { t } from './i18n';
import { Money, SectionTitle, card, displayName, errorText, input } from './ui';

/** Records that a supplier or driver was paid by EFT: bank reference, the bank's charge, and the proof. */
export function PaidByEftForm({ transfer, onClose, onDone }: { transfer: TransferRow; onClose: () => void; onDone: () => void }) {
  const [reference, setReference] = useState('');
  const [fee, setFee] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    const bankFeeCents = randsToCents(fee);
    if (bankFeeCents === undefined) return setMsg(t('admin.billing.feeInvalid'));
    if (!file) return setMsg(t('admin.payouts.proofRequired'));
    setBusy(true);
    const r = await markTransferPaid({ transferId: transfer.id, reference: reference.trim(), bankFeeCents, file });
    setBusy(false);
    if (r.error) return setMsg(errorText({ message: r.error }));
    onDone();
  }

  return (
    <section className={`${card} mt-4`} data-testid="paid-by-eft">
      <SectionTitle>{t('admin.payouts.paidTitle', { name: displayName(transfer.party) })}</SectionTitle>
      <p className="font-body text-sm">{t('admin.payouts.paidBody')} <Money cents={transfer.amount_cents} strong /></p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3 font-body text-sm">
        <label className="flex flex-col gap-1">{t('admin.payouts.bankReference')}
          <input className={input} aria-label={t('admin.payouts.bankReference')} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">{t('admin.billing.bankFee')}
          <input className={input} inputMode="decimal" aria-label={t('admin.billing.bankFee')} placeholder="0.00" value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">{t('admin.payouts.proof')}
          <input type="file" accept="image/*,application/pdf" aria-label={t('admin.payouts.proof')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {msg && <p role="alert" className="mt-2 font-body text-sm text-chilli">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy} onClick={() => void submit()}>{t('admin.payouts.markPaid')}</Button>
        <Button variant="secondary" onClick={onClose}>{t('admin.common.cancel')}</Button>
      </div>
      <p className="mt-2 font-body text-xs text-ink/50">{t('admin.payouts.paidNote')}</p>
    </section>
  );
}

/** Bank statements the admin has filed, so every EFT fee and payout can be traced to a document. */
export function StatementsCard() {
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    listBankStatements().then((r) => live && setRows(r)).catch(() => undefined);
    return () => { live = false; };
  }, [tick]);

  async function upload() {
    if (!file) return setMsg(t('admin.payouts.statementFile'));
    setBusy(true);
    setMsg(null);
    const r = await addBankStatement({ file, from: from || null, to: to || null, note });
    setBusy(false);
    if (r.error) return setMsg(errorText({ message: r.error }));
    setFile(null); setNote(''); setFrom(''); setTo('');
    setTick((n) => n + 1);
  }

  return (
    <section className={`${card} mt-6`} data-testid="bank-statements">
      <SectionTitle>{t('admin.payouts.statements')}</SectionTitle>
      <p className="font-body text-sm text-ink/70">{t('admin.payouts.statementsHelp')}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-4 font-body text-sm">
        <label className="flex flex-col gap-1">{t('admin.payouts.statementFile')}
          <input type="file" accept="application/pdf,image/*,text/csv" aria-label={t('admin.payouts.statementFile')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="flex flex-col gap-1">{t('admin.payouts.periodFrom')}
          <input type="date" className={input} aria-label={t('admin.payouts.periodFrom')} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">{t('admin.payouts.periodTo')}
          <input type="date" className={input} aria-label={t('admin.payouts.periodTo')} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">{t('admin.billing.note')}
          <input className={input} aria-label={t('admin.billing.note')} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {msg && <p role="alert" className="mt-2 font-body text-sm text-chilli">{msg}</p>}
      <div className="mt-3"><Button disabled={busy} onClick={() => void upload()}>{t('admin.payouts.statementUpload')}</Button></div>
      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-ink/10 font-body text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span>{[r.period_from, r.period_to].filter(Boolean).join(' to ') || new Date(r.created_at).toLocaleDateString('en-ZA')}{r.note ? ` · ${r.note}` : ''}</span>
              <button type="button" className="font-semibold text-chilli" onClick={() => void openProof(r.file_path)}>{t('admin.billing.viewProof')}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
