import { useState } from 'react';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import { loadQuoteCandidates, loadQuotes, priceQuote, type QuoteCandidate, type QuoteRequestRow } from './api';
import { useAdminData } from './hooks/useAdminData';
import { t } from './i18n';
import { AdminLayout, Empty, LoadState, Money, Pill, Tabs, card, displayName, errorText, formatDateTime, input, td, th } from './ui';

type Tab = 'open' | 'all';

export default function AdminQuotes() {
  const [tab, setTab] = useState<Tab>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData(loadQuotes, []);
  const all = data ?? [];
  const waiting = (q: QuoteRequestRow) => q.kind === 'requested' && q.status === 'open' && q.total_cents === null;
  const rows = tab === 'open' ? all.filter(waiting) : all;

  return (
    <AdminLayout title={t('admin.quotes.title')} subtitle={t('admin.quotes.subtitle')}>
      <Tabs<Tab>
        tabs={[{ value: 'open', label: t('admin.quotes.tabOpen'), count: all.filter(waiting).length }, { value: 'all', label: t('admin.quotes.tabAll'), count: all.length }]}
        value={tab}
        onChange={setTab}
      />
      <LoadState loading={loading} error={error} hasData={!!data}>
        {rows.length === 0 ? <Empty title={t('admin.quotes.none')} /> : (
          <ul className="mt-3 flex flex-col gap-3">
            {rows.map((q) => (
              <li key={q.id} className={card}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-body text-sm">
                  <span className="font-semibold">{displayName(q.buyer)}</span>
                  <span>{q.quantity} {q.bird_type.replace(/_/g, ' ')}, {q.weight_band.replace(/_/g, ' ')}</span>
                  <span className="text-ink/60">{[q.address?.town, q.address?.province].filter(Boolean).join(', ')}</span>
                  <span className="text-ink/60">{formatDateTime(q.created_at)}</span>
                  <Pill tone={waiting(q) ? 'warn' : q.status === 'accepted' ? 'good' : 'neutral'}>
                    {waiting(q) ? t('admin.quotes.needsPrice') : q.status}
                  </Pill>
                  {q.total_cents !== null && <Money cents={q.total_cents} strong />}
                  {waiting(q) && (
                    <Button variant="secondary" onClick={() => setOpenId(openId === q.id ? null : q.id)}>
                      {openId === q.id ? t('admin.common.close') : t('admin.quotes.price')}
                    </Button>
                  )}
                </div>
                {openId === q.id && <PricePanel quote={q} onDone={() => { setOpenId(null); reload(); }} />}
              </li>
            ))}
          </ul>
        )}
      </LoadState>
    </AdminLayout>
  );
}

function PricePanel({ quote, onDone }: { quote: QuoteRequestRow; onDone: () => void }) {
  const cands = useAdminData(() => loadQuoteCandidates(quote.id), [quote.id]);
  const [birds, setBirds] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list: QuoteCandidate[] = cands.data ?? [];
  const total = list.reduce((a, c) => a + (Number(birds[c.supplier_id]) || 0), 0);

  async function submit() {
    setBusy(true);
    const allocations = list
      .filter((c) => Number(birds[c.supplier_id]) > 0)
      .map((c) => ({ supplier_id: c.supplier_id, birds: Number(birds[c.supplier_id]), price_cents: c.price_cents }));
    const r = await priceQuote(quote.id, allocations);
    setBusy(false);
    setMsg(errorText(r.error));
    if (!r.error) onDone();
  }

  return (
    <div className="mt-4 border-t border-ink/10 pt-4">
      <p className="mb-2 font-body text-xs text-ink/60">{t('admin.quotes.priceHelp', { n: quote.quantity })}</p>
      <LoadState loading={cands.loading} error={cands.error} hasData={!!cands.data}>
        {list.length === 0 ? <Empty title={t('admin.quotes.noSuppliers')} /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className={th}>{t('admin.quotes.supplier')}</th><th className={th}>{t('admin.quotes.pricePerBird')}</th>
                <th className={th}>{t('admin.quotes.distance')}</th><th className={th}>{t('admin.quotes.stock')}</th><th className={th}>{t('admin.quotes.birds')}</th>
              </tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.supplier_id}>
                    <td className={td}>{c.supplier_name}{c.same_province ? '' : ` (${t('admin.quotes.otherProvince')})`}</td>
                    <td className={td}><Money cents={c.price_cents} /></td>
                    <td className={td}>{c.distance_km} km</td>
                    <td className={td}>{c.stock_available}</td>
                    <td className={td}>
                      <input className={`${input} w-24`} inputMode="numeric" aria-label={`${t('admin.quotes.birds')} ${c.supplier_name}`}
                        value={birds[c.supplier_id] ?? ''} onChange={(e) => setBirds({ ...birds, [c.supplier_id]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LoadState>
      <FormError message={msg} />
      <div className="mt-3 flex items-center gap-4 font-body text-sm">
        <span className={total === quote.quantity ? 'text-green-700' : 'text-ink/60'}>{t('admin.quotes.allocated', { a: total, n: quote.quantity })}</span>
        <Button disabled={busy || total !== quote.quantity} onClick={() => void submit()}>{t('admin.quotes.send')}</Button>
      </div>
    </div>
  );
}
