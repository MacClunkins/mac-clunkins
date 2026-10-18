import { useState } from 'react';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import { loadDriverParties, loadQuoteCandidates, loadQuotes, priceQuote, type QuoteCandidate, type QuoteRequestRow } from './api';
import { summariseBlockers, whatsappLink } from './logic/blockers';
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
            {rows.map((q) => <QuoteCard key={q.id} q={q} isWaiting={waiting(q)} open={openId === q.id} onToggle={() => setOpenId(openId === q.id ? null : q.id)} onDone={() => { setOpenId(null); reload(); }} />)}
          </ul>
        )}
      </LoadState>
    </AdminLayout>
  );
}

function QuoteCard({ q, isWaiting, open, onToggle, onDone }: {
  q: QuoteRequestRow; isWaiting: boolean; open: boolean; onToggle: () => void; onDone: () => void;
}) {
  // Loaded up front for quotes waiting on a price, so the card says what is blocking without a click.
  const cands = useAdminData(() => (isWaiting ? loadQuoteCandidates(q.id) : Promise.resolve({ data: [], error: null })), [q.id, isWaiting]);
  const drivers = useAdminData(() => (isWaiting ? loadDriverParties() : Promise.resolve({ data: [], error: null })), [q.id, isWaiting]);
  const summary = cands.data && drivers.data ? summariseBlockers(cands.data, drivers.data) : null;
  return (
    <li className={card}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-body text-sm">
        <span className="font-semibold">{displayName(q.buyer)}</span>
        <span>{q.quantity} {q.bird_type.replace(/_/g, ' ')}, {q.weight_band.replace(/_/g, ' ')}</span>
        <span className="text-ink/60">{[q.address?.town, q.address?.province].filter(Boolean).join(', ')}</span>
        <span className="text-ink/60">{formatDateTime(q.created_at)}</span>
        <Pill tone={isWaiting ? (summary && !summary.ready ? 'bad' : 'warn') : q.status === 'accepted' ? 'good' : 'neutral'}>
          {isWaiting ? (summary ? (summary.ready ? t('admin.quotes.readyPill') : t('admin.quotes.blockedPill')) : t('admin.quotes.needsPrice')) : q.status}
        </Pill>
        {q.total_cents !== null && <Money cents={q.total_cents} strong />}
        {isWaiting && <Button variant="secondary" onClick={onToggle}>{open ? t('admin.common.close') : t('admin.quotes.price')}</Button>}
      </div>
      {isWaiting && summary && !summary.ready && <Blockers summary={summary} />}
      {isWaiting && summary?.ready && <p className="mt-2 font-body text-sm text-green-800">{t('admin.quotes.readyBody', { n: summary.eligibleCount })}</p>}
      {open && <PricePanel quote={q} cands={cands} onDone={onDone} />}
    </li>
  );
}

function Blockers({ summary }: { summary: ReturnType<typeof summariseBlockers> }) {
  return (
    <div className="mt-3 rounded-xl border border-chilli/30 bg-chilli/5 p-4" data-testid="quote-blockers">
      <h3 className="font-heading text-sm font-bold">{t('admin.quotes.blockedTitle')}</h3>
      <p className="mt-1 font-body text-sm text-ink/70">{t('admin.quotes.blockedIntro')}</p>
      <ul className="mt-3 flex flex-col gap-4 font-body text-sm">
        {summary.suppliers.map(({ supplier, reasons }) => {
          const named = reasons.filter((r) => r !== 'no_driver');
          if (!named.length) return null;
          return (
            <li key={supplier.supplier_id}>
              <p className="font-semibold">{t('admin.quotes.partySupplier', { name: supplier.supplier_name })}</p>
              <ul className="mt-1 flex flex-col gap-2">
                {named.map((r) => <Step key={r} what={t(`admin.quotes.reason.${r}`)} ask={t(`admin.quotes.ask.${r}`, { name: supplier.supplier_name })} phone={supplier.phone} />)}
              </ul>
            </li>
          );
        })}
        {(summary.noDriversAtAll || summary.drivers.length > 0) && (
          <li>
            <p className="font-semibold">{t('admin.quotes.partyDrivers')}</p>
            <p className="mt-1 text-ink/70">{t('admin.quotes.reason.no_driver')}</p>
            <ul className="mt-1 flex flex-col gap-2">
              {summary.noDriversAtAll && <li>{t('admin.quotes.noDriversAtAll')}</li>}
              {summary.drivers.map(({ driver, issues }) => issues.map((i) => (
                <Step key={`${driver.id}-${i}`} what={`${driver.name}: ${t(`admin.quotes.driverIssue.${i}`)}`} ask={t(`admin.quotes.driverAsk.${i}`, { name: driver.name })} phone={driver.phone} />
              )))}
            </ul>
          </li>
        )}
      </ul>
    </div>
  );
}

/** One thing that is wrong, who to message, and a ready-written WhatsApp message. */
function Step({ what, ask, phone }: { what: string; ask: string; phone: string | null }) {
  const link = whatsappLink(phone, ask);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2">
      <span className="max-w-xl">{what}</span>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-full bg-chilli px-3 py-1 text-xs font-semibold text-cream">
          {t('admin.quotes.whatsapp')}
        </a>
      ) : <span className="text-xs text-ink/50">{t('admin.quotes.noPhone')}</span>}
    </li>
  );
}

function PricePanel({ quote, cands, onDone }: { quote: QuoteRequestRow; cands: ReturnType<typeof useAdminData<QuoteCandidate[]>>; onDone: () => void }) {
  const [birds, setBirds] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list: QuoteCandidate[] = cands.data ?? [];
  const total = list.reduce((a, c) => a + (c.eligible ? Number(birds[c.supplier_id]) || 0 : 0), 0);

  async function submit() {
    setBusy(true);
    const allocations = list
      .filter((c) => c.eligible && c.price_cents !== null && Number(birds[c.supplier_id]) > 0)
      .map((c) => ({ supplier_id: c.supplier_id, birds: Number(birds[c.supplier_id]), price_cents: c.price_cents as number }));
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
          <>
          {!list.some((c) => c.eligible) && <p role="status" className="mb-2 rounded-xl bg-mustard/25 px-3 py-2 font-body text-sm">{t('admin.quotes.noneEligible')}</p>}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className={th}>{t('admin.quotes.supplier')}</th><th className={th}>{t('admin.quotes.pricePerBird')}</th>
                <th className={th}>{t('admin.quotes.distance')}</th><th className={th}>{t('admin.quotes.stock')}</th><th className={th}>{t('admin.quotes.birds')}</th>
              </tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.supplier_id} className={c.eligible ? '' : 'opacity-70'}>
                    <td className={td}>
                      {c.supplier_name}{c.eligible && c.same_province === false ? ` (${t('admin.quotes.otherProvince')})` : ''}
                      {!c.eligible && (
                        <ul className="mt-1 list-disc pl-4 text-xs text-chilli">
                          {c.reasons.map((r) => <li key={r}>{t(`admin.quotes.reason.${r}`)}</li>)}
                        </ul>
                      )}
                    </td>
                    <td className={td}>{c.price_cents === null ? '-' : <Money cents={c.price_cents} />}</td>
                    <td className={td}>{c.distance_km === null ? '-' : `${c.distance_km} km`}</td>
                    <td className={td}>{c.stock_available ?? '-'}</td>
                    <td className={td}>
                      <input className={`${input} w-24`} inputMode="numeric" disabled={!c.eligible} aria-label={`${t('admin.quotes.birds')} ${c.supplier_name}`}
                        value={birds[c.supplier_id] ?? ''} onChange={(e) => setBirds({ ...birds, [c.supplier_id]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
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
