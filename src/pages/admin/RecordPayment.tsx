import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { adminMarkOrderPaid, listBillingDocs, openBillingPdf, type BillingDoc, type ManualMethod } from '../../lib/billing';
import { formatCents } from '../../lib/format';
import { listOrderProofs, openProof, randsToCents, type ProofRow } from '../../lib/paymentProofs';
import { t } from './i18n';
import { SectionTitle, card, errorText, input } from './ui';

const METHODS: ManualMethod[] = ['eft', 'cash', 'card_machine', 'other'];

/** MVP 1: payment happens outside the app. The admin confirms it here, which issues the receipt. */
export function RecordPayment({ orderId, status, totalCents, onDone }: { orderId: string; status: string; totalCents: number; onDone: () => void }) {
  const [docs, setDocs] = useState<BillingDoc[]>([]);
  const [method, setMethod] = useState<ManualMethod>('eft');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [fee, setFee] = useState('');
  const [proofs, setProofs] = useState<ProofRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listBillingDocs(orderId).then((d) => live && setDocs(d)).catch(() => undefined);
    listOrderProofs(orderId).then((p) => live && setProofs(p)).catch(() => undefined);
    return () => { live = false; };
  }, [orderId, status]);

  async function submit() {
    const bankFeeCents = randsToCents(fee);
    if (bankFeeCents === undefined) return setMsg(t('admin.billing.feeInvalid'));
    setBusy(true);
    const r = await adminMarkOrderPaid({ orderId, amountCents: totalCents, method, reference, note, bankFeeCents });
    setMsg(errorText(r.error));
    setBusy(false);
    if (!r.error) onDone();
  }

  return (
    <section className={card}>
      <SectionTitle>{t('admin.billing.title')}</SectionTitle>
      {status === 'placed' ? (
        <div className="flex flex-col gap-3 font-body text-sm">
          <p>{t('admin.billing.amountDue', { amount: formatCents(totalCents) })}</p>
          <label className="flex flex-col gap-1">{t('admin.billing.method')}
            <select className={input} value={method} onChange={(e) => setMethod(e.target.value as ManualMethod)}>
              {METHODS.map((m) => <option key={m} value={m}>{t(`admin.billing.methods.${m}`)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">{t('admin.billing.reference')}
            <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">{t('admin.billing.bankFee')}
            <input className={input} inputMode="decimal" aria-label={t('admin.billing.bankFee')} placeholder="0.00" value={fee} onChange={(e) => setFee(e.target.value)} />
            <span className="text-xs text-ink/50">{t('admin.billing.bankFeeHelp')}</span>
          </label>
          <label className="flex flex-col gap-1">{t('admin.billing.note')}
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {msg && <p role="alert" className="text-chilli">{msg}</p>}
          <Button disabled={busy} onClick={() => void submit()}>{t('admin.billing.markPaid')}</Button>
          <p className="text-xs text-ink/50">{t('admin.billing.markPaidNote')}</p>
        </div>
      ) : (
        <p className="font-body text-sm text-ink/70">{t('admin.billing.notPayable')}</p>
      )}
      <div className="mt-3 font-body text-sm" data-testid="buyer-proofs">
        <p className="font-semibold">{t('admin.billing.buyerProofs')}</p>
        {proofs.length === 0 ? <p className="text-ink/60">{t('admin.billing.noProofs')}</p> : (
          <ul className="divide-y divide-ink/10">
            {proofs.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>{new Date(p.created_at).toLocaleString('en-ZA')}</span>
                <button type="button" className="font-semibold text-chilli" onClick={() => void openProof(p.file_path)}>{t('admin.billing.viewProof')}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {docs.length > 0 && (
        <ul className="mt-3 divide-y divide-ink/10 font-body text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2">
              <span>{t(`admin.billing.kind.${d.kind}`)} - {d.number}</span>
              <button type="button" className="font-semibold text-chilli" onClick={() => void openBillingPdf(d.id)}>{t('admin.billing.download')}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
