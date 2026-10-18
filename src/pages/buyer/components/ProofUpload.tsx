import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { listOrderProofs, openProof, submitBuyerProof, type ProofRow } from '../../../lib/paymentProofs';
import { t } from '../i18n-shim';

/** The buyer sends the EFT slip for an order, and sees what they already sent. */
export function ProofUpload({ orderId }: { orderId: string }) {
  const [proofs, setProofs] = useState<ProofRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    listOrderProofs(orderId).then((p) => live && setProofs(p)).catch(() => undefined);
    return () => { live = false; };
  }, [orderId, tick]);

  async function send() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    const r = uid ? await submitBuyerProof(orderId, uid, file) : { error: 'not signed in' };
    setBusy(false);
    if (r.error) return setMsg(t('buyer.billing.proofError'));
    setFile(null);
    setMsg(t('buyer.billing.proofSent'));
    setTick((n) => n + 1);
  }

  return (
    <div className="mb-4" data-testid="proof-upload">
      <h3 className="font-heading text-sm font-bold">{t('buyer.billing.proofTitle')}</h3>
      <p className="mt-1 text-xs text-ink/60">{t('buyer.billing.proofHelp')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="file" accept="image/*,application/pdf" aria-label={t('buyer.billing.proofFile')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <button type="button" disabled={!file || busy} onClick={() => void send()} className="rounded-full bg-chilli px-4 py-2 text-sm font-semibold text-cream disabled:opacity-50">
          {t('buyer.billing.proofSend')}
        </button>
      </div>
      {msg && <p role="status" className="mt-1 text-sm">{msg}</p>}
      {proofs.length > 0 && (
        <ul className="mt-2 text-sm">
          {proofs.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-1">
              <span>{t('buyer.billing.proofSentOn', { date: new Date(p.created_at).toLocaleDateString('en-ZA') })}</span>
              <button type="button" className="font-semibold text-chilli" onClick={() => void openProof(p.file_path)}>{t('buyer.billing.proofView')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
