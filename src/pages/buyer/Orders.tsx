import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/DashboardShell';
import { FormError } from '../../components/FormField';
import { PageSpinner } from '../../components/PageSpinner';
import { formatCents } from '../../lib/format';
import { listOrders, listQuotes } from './api';
import { BuyerLayout, Card } from './components/BuyerLayout';
import { StatusBadge } from './components/StatusBadge';
import { useAsync } from './hooks/useAsync';
import { t } from './i18n-shim';
import { formatDate, formatMonth } from './lib/dates';
import { isWaitingForPrice, visibleQuotes } from './lib/quoteList';
import {
  FILTER_KEYS,
  type FilterKey,
  IN_PROGRESS,
  filterCounts,
  groupByMonth,
  matchesFilter,
  paginate,
  searchOrders,
  sortNewestFirst,
  yearTotals,
} from './lib/orderFilters';
import type { OrderRow } from './types';

const PAGE_SIZE = 10;

const labelOf = (o: OrderRow) => t(`buyer.birdType.${o.bird_type}`);
const hasInvoice = (o: OrderRow) => o.status !== 'placed' && o.status !== 'cancelled';

export default function BuyerOrders() {
  const { data, loading, error } = useAsync(listOrders, []);
  const quotes = useAsync(listQuotes, []);
  const openQuotes = visibleQuotes(quotes.data ?? []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);
  const [year, setYear] = useState(new Date().getFullYear());

  const all = useMemo(() => sortNewestFirst(data ?? []), [data]);
  // Counts reflect the search, so chips always tell the truth about what a click would show.
  const searched = useMemo(() => searchOrders(all, query, labelOf), [all, query]);
  const counts = filterCounts(searched);
  const shown = searched.filter((o) => matchesFilter(o, filter));
  const inProgress = shown.filter((o) => IN_PROGRESS.includes(o.status));
  const past = shown.filter((o) => !IN_PROGRESS.includes(o.status));
  const paged = paginate(past, page, PAGE_SIZE);
  const groups = groupByMonth(paged.items);
  const years = useMemo(() => {
    const ys = new Set(all.map((o) => new Date(o.placed_at).getFullYear()));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [all]);
  const totals = yearTotals(all, year);

  return (
    <BuyerLayout wide>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold">{t('buyer.orders.title')}</h1>
        <Link
          to="/orders/new"
          className="rounded-full bg-chilli px-5 py-2.5 font-semibold text-cream hover:bg-chilli/90"
        >
          {t('buyer.orders.newOrder')}
        </Link>
      </div>

      {openQuotes.length > 0 && (
        <section aria-label={t('buyer.quotes.title')} className="mt-6">
          <h2 className="mb-2 font-heading text-lg font-bold">{t('buyer.quotes.title')}</h2>
          <ul className="flex flex-col gap-3">
            {openQuotes.map((q) => (
              <li key={q.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {t('buyer.orders.birdsLine', { n: q.quantity, type: t(`buyer.birdType.${q.bird_type}`) })}
                      </p>
                      <p className="text-sm text-ink/70" data-testid="quote-state">
                        {isWaitingForPrice(q)
                          ? t('buyer.quotes.waiting')
                          : `${t('buyer.quotes.ready')} · ${formatCents(q.total_cents ?? 0)}${q.expires_at ? ` · ${t('buyer.quotes.until', { when: formatDate(q.expires_at) })}` : ''}`}
                      </p>
                    </div>
                    {!isWaitingForPrice(q) && (
                      <Link
                        to={`/quotes/${q.id}`}
                        className="rounded-full bg-chilli px-4 py-2 font-semibold text-cream hover:bg-chilli/90"
                      >
                        {t('buyer.quotes.view')}
                      </Link>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && <PageSpinner label={t('buyer.orders.loading')} />}
      <FormError message={error ? t('buyer.orders.loadError', { message: error }) : null} />

      {!loading && !error && all.length === 0 && (
        <div className="mt-6">
          <EmptyState title={t('buyer.orders.emptyTitle')} body={t('buyer.orders.emptyBody')} />
        </div>
      )}

      {!loading && !error && all.length > 0 && (
        <>
          <section
            aria-label={t('buyer.orders.yearTotals')}
            className="mt-6 hidden grid-cols-4 gap-4 lg:grid"
          >
            <Card>
              <label className="text-xs font-semibold uppercase tracking-wide text-ink/60" htmlFor="year">
                {t('buyer.orders.year')}
              </label>
              <select
                id="year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="mt-1 block w-full rounded-lg border border-ink/15 bg-white px-2 py-1 font-heading text-xl font-bold"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Card>
            <Stat label={t('buyer.orders.statSpent')} value={formatCents(totals.spentCents)} />
            <Stat label={t('buyer.orders.statOrders')} value={String(totals.orders)} />
            <Stat label={t('buyer.orders.statBirds')} value={String(totals.birds)} />
          </section>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder={t('buyer.orders.searchPlaceholder')}
              aria-label={t('buyer.orders.searchLabel')}
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 sm:max-w-xs"
            />
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('buyer.orders.filters')}>
              {FILTER_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => {
                    setFilter(k);
                    setPage(1);
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                    filter === k ? 'bg-ink text-cream' : 'bg-white text-ink/70 ring-1 ring-ink/15 hover:bg-ink/5'
                  }`}
                >
                  {t(`buyer.orders.filter.${k}`)} <span className="opacity-70">({counts[k]})</span>
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 && (
            <div className="mt-6">
              <EmptyState title={t('buyer.orders.noMatchTitle')} body={t('buyer.orders.noMatchBody')} />
            </div>
          )}

          {inProgress.length > 0 && (
            <section className="mt-8" aria-label={t('buyer.orders.inProgress')}>
              <h2 className="mb-3 font-heading text-lg font-bold">{t('buyer.orders.inProgress')}</h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {inProgress.map((o) => (
                  <li key={o.id}>
                    <Link
                      to={`/orders/${o.id}`}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-mustard/60 hover:ring-chilli"
                    >
                      <div>
                        <p className="font-heading font-bold">{o.number}</p>
                        <p className="text-sm text-ink/60">
                          {t('buyer.orders.birdsLine', { n: o.quantity, type: labelOf(o) })}
                          {o.delivery_date ? ` · ${formatDate(o.delivery_date)}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-heading font-bold">{formatCents(o.total_cents)}</p>
                        <StatusBadge status={o.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {groups.length > 0 && (
            <section className="mt-8" aria-label={t('buyer.orders.past')}>
              <h2 className="mb-3 font-heading text-lg font-bold">{t('buyer.orders.past')}</h2>
              {groups.map((g) => (
                <div key={g.key} className="mb-6">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="font-semibold">{formatMonth(g.date)}</h3>
                    <p className="text-sm text-ink/60" data-testid={`month-total-${g.key}`}>
                      {t('buyer.orders.monthTotal', { amount: formatCents(g.totalCents) })}
                    </p>
                  </div>

                  <ul className="flex flex-col gap-2 lg:hidden">
                    {g.orders.map((o) => (
                      <li key={o.id}>
                        <Link
                          to={`/orders/${o.id}`}
                          className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm"
                        >
                          <div>
                            <p className="font-heading font-bold">{o.number}</p>
                            <p className="text-sm text-ink/60">
                              {t('buyer.orders.birdsLine', { n: o.quantity, type: labelOf(o) })}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-heading font-bold">{formatCents(o.total_cents)}</p>
                            <StatusBadge status={o.status} />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>

                  <table className="hidden w-full overflow-hidden rounded-2xl bg-white text-sm shadow-sm lg:table">
                    <thead className="bg-ink/5 text-left text-xs uppercase tracking-wide text-ink/60">
                      <tr>
                        <th className="px-4 py-2">{t('buyer.orders.col.order')}</th>
                        <th className="px-4 py-2">{t('buyer.orders.col.date')}</th>
                        <th className="px-4 py-2">{t('buyer.orders.col.birds')}</th>
                        <th className="px-4 py-2">{t('buyer.orders.col.status')}</th>
                        <th className="px-4 py-2 text-right">{t('buyer.orders.col.total')}</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink/10">
                      {g.orders.map((o) => (
                        <tr key={o.id}>
                          <td className="px-4 py-3 font-heading font-bold">
                            <Link to={`/orders/${o.id}`} className="hover:text-chilli">
                              {o.number}
                            </Link>
                          </td>
                          <td className="px-4 py-3">{formatDate(o.placed_at)}</td>
                          <td className="px-4 py-3">
                            {t('buyer.orders.birdsLine', { n: o.quantity, type: labelOf(o) })}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={o.status} />
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">{formatCents(o.total_cents)}</td>
                          <td className="space-x-3 px-4 py-3 text-right">
                            {hasInvoice(o) && (
                              <Link to={`/orders/${o.id}#invoice`} className="font-semibold text-chilli">
                                {t('buyer.orders.invoice')}
                              </Link>
                            )}
                            <Link to={`/orders/new?reorder=${o.id}`} className="font-semibold text-chilli">
                              {t('buyer.orders.reorder')}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

              {paged.pages > 1 && (
                <nav className="mt-4 flex items-center justify-between" aria-label={t('buyer.orders.paging')}>
                  <button
                    type="button"
                    disabled={paged.page <= 1}
                    onClick={() => setPage(paged.page - 1)}
                    className="rounded-full px-4 py-2 font-semibold ring-1 ring-ink/15 disabled:opacity-40"
                  >
                    {t('buyer.orders.prev')}
                  </button>
                  <span className="text-sm text-ink/60">
                    {t('buyer.orders.pageOf', { page: paged.page, pages: paged.pages })}
                  </span>
                  <button
                    type="button"
                    disabled={paged.page >= paged.pages}
                    onClick={() => setPage(paged.page + 1)}
                    className="rounded-full px-4 py-2 font-semibold ring-1 ring-ink/15 disabled:opacity-40"
                  >
                    {t('buyer.orders.next')}
                  </button>
                </nav>
              )}
            </section>
          )}
        </>
      )}
    </BuyerLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">{label}</p>
      <p className="mt-1 font-heading text-2xl font-bold">{value}</p>
    </Card>
  );
}
