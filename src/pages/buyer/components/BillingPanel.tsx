import { useEffect, useState } from 'react';
import { getPaymentInstructions, listBillingDocs, openBillingPdf, type BillingDoc, type PaymentInstructions } from '../../../lib/billing';
import { formatCents } from '../../../lib/format';
import { Card } from './BuyerLayout';
import { t } from '../i18n-shim';
import { ProofUpload } from './ProofUpload';

/** Manual-payment mode: EFT instructions while unpaid, plus the invoice/receipt PDFs. */
export function BillingPanel({ orderId, unpaid }: { orderId: string; unpaid: boolean }) {
  const [docs, setDocs] = useState<BillingDoc[]>([]);
  const [info, setInfo] = useState<PaymentInstructions | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    listBillingDocs(orderId).then((d) => live && setDocs(d)).catch(() => live && setErr(true));
    if (unpaid) getPaymentInstructions(orderId).then((i) => live && setInfo(i)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [orderId, unpaid]);

  async function open(id: string) {
    setErr(false);
    try { await openBillingPdf(id); } catch { setErr(true); }
  }

  return (
    <Card>
      {unpaid && info && (
        <div data-testid="eft-instructions" className="mb-4">
          <h2 className="font-heading font-bold">{t('buyer.billing.payTitle')}</h2>
          <p className="mt-1 text-sm text-ink/70">{t('buyer.billing.payBody', { amount: formatCents(info.amount_cents) })}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink/60">{t('buyer.billing.bank')}</dt><dd>{info.bank_name || '—'}</dd>
            <dt className="text-ink/60">{t('buyer.billing.holder')}</dt><dd>{info.account_holder || '—'}</dd>
            <dt className="text-ink/60">{t('buyer.billing.account')}</dt><dd>{info.account_number || '—'}</dd>
            <dt className="text-ink/60">{t('buyer.billing.branch')}</dt><dd>{info.branch_code || '—'}</dd>
            <dt className="text-ink/60">{t('buyer.billing.type')}</dt><dd>{info.account_type || '—'}</dd>
            <dt className="text-ink/60">{t('buyer.billing.reference')}</dt><dd className="font-semibold">{info.reference}</dd>
          </dl>
          <p className="mt-2 text-xs text-ink/60">{t('buyer.billing.afterPay')}</p>
          <div className="mt-4"><ProofUpload orderId={orderId} /></div>
        </div>
      )}
      <h2 className="font-heading font-bold">{t('buyer.billing.docsTitle')}</h2>
      {docs.length === 0 ? (
        <p className="mt-1 text-sm text-ink/60">{t('buyer.billing.noDocs')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-ink/10 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2">
              <span>{t(`buyer.billing.kind.${d.kind}`)} · {d.number}</span>
              <button type="button" onClick={() => void open(d.id)} className="font-semibold text-chilli">{t('buyer.billing.download')}</button>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-chilli">{t('buyer.billing.error')}</p>}
    </Card>
  );
}
