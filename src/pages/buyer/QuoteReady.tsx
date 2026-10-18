import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import { PageSpinner } from '../../components/PageSpinner';
import { declineQuote, getQuote } from './api';
import { BuyerLayout, Card } from './components/BuyerLayout';
import { QuoteLines } from './components/LineItems';
import { useAsync } from './hooks/useAsync';
import { useNow } from './hooks/useNow';
import { t } from './i18n-shim';
import { formatDateTime } from './lib/dates';
import { issueQuoteDocument, openBillingPdf } from '../../lib/billing';
import { remainingMs } from './lib/quote';

export default function QuoteReady() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: q, loading, error } = useAsync(() => getQuote(id), [id]);
  const now = useNow(30_000);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const expired = !!q?.expires_at && remainingMs(q.expires_at, now) === 0;
  const open = !!q && q.status === 'open' && !expired;

  // Review and pay decides what happens next: place the order (manual payments) or go to Paystack.
  function onContinue() {
    if (q) navigate(`/orders/new/pay?quote=${q.id}`);
  }

  async function onDownload() {
    if (!q) return;
    setActionError(null);
    try {
      await openBillingPdf(await issueQuoteDocument(q.id));
    } catch {
      setActionError(t('buyer.quoteReady.pdfError'));
    }
  }

  async function onDecline() {
    if (!q) return;
    setBusy(true);
    setActionError(null);
    try {
      await declineQuote(q.id);
      navigate('/orders');
    } catch {
      setActionError(t('buyer.quoteReady.declineError'));
      setBusy(false);
    }
  }

  return (
    <BuyerLayout>
      <h1 className="mb-5 font-heading text-2xl font-bold">{t('buyer.quoteReady.title')}</h1>
      {loading && <PageSpinner label={t('buyer.quoteReady.loading')} />}
      <FormError message={error ? t('buyer.quoteReady.loadError') : null} />
      {q && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-sm text-ink/70">{t('buyer.quoteReady.intro')}</p>
            <div className="mt-3">
              <QuoteLines q={q} />
            </div>
            {q.expires_at && (
              <p className="mt-3 text-sm">
                {t(expired ? 'buyer.quoteReady.expiredOn' : 'buyer.quoteReady.validUntil', {
                  when: formatDateTime(q.expires_at),
                })}
              </p>
            )}
          </Card>

          {q.status !== 'open' && (
            <Card className="ring-1 ring-mustard">
              <p className="font-semibold">{t(`buyer.quoteReady.status.${q.status}`)}</p>
            </Card>
          )}

          <FormError message={actionError} />
          {open && (
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy} onClick={onContinue}>
                {t('buyer.quoteReady.pay')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void onDownload()}>
                {t('buyer.quoteReady.download')}
              </Button>
              {!confirmDecline ? (
                <Button variant="secondary" disabled={busy} onClick={() => setConfirmDecline(true)}>
                  {t('buyer.quoteReady.decline')}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm">{t('buyer.quoteReady.declineSure')}</span>
                  <Button variant="secondary" disabled={busy} onClick={() => void onDecline()}>
                    {t('buyer.quoteReady.declineYes')}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmDecline(false)}>
                    {t('buyer.quoteReady.declineNo')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </BuyerLayout>
  );
}
