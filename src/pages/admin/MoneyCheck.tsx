import { useState } from 'react';
import { Link } from 'react-router-dom';
import { loadMoneyCheck } from './api';
import { useAdminData } from './hooks/useAdminData';
import { checkOrderMoney, sortChecks, summarize, type MoneyFlag } from './logic/moneyCheck';
import { t } from './i18n';
import { AdminLayout, Empty, LoadState, Money, Pill, card, tStatus } from './ui';

const FLAG_TONE: Record<MoneyFlag, 'bad' | 'warn'> = {
  negative_margin: 'bad', margin_high: 'warn', short_load: 'warn', supplier_mismatch: 'bad',
  driver_mismatch: 'bad', missing_supplier_payout: 'bad', unpaid_delivered: 'bad', payout_before_payment: 'bad',
};

export default function AdminMoneyCheck() {
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const { data, loading, error } = useAdminData(() => loadMoneyCheck(), []);
  const checks = sortChecks((data ?? []).map(checkOrderMoney));
  const sum = summarize(checks);
  const shown = onlyFlagged ? checks.filter((c) => c.flags.length > 0) : checks;

  return (
    <AdminLayout title={t('admin.moneyCheck.title')} subtitle={t('admin.moneyCheck.subtitle')}>
      <LoadState loading={loading} error={error} hasData={!!data}>
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className={card}><p className="font-heading text-xl font-bold">{sum.orders}</p><p className="font-body text-sm text-ink/60">{t('admin.moneyCheck.checked')}</p></div>
          <div className={card}><p className="font-heading text-xl font-bold" data-testid="flagged-count">{sum.flagged}</p><p className="font-body text-sm text-ink/60">{t('admin.moneyCheck.flagged')}</p></div>
          <div className={card}><p className="font-heading text-xl font-bold"><Money cents={sum.paidCents} /></p><p className="font-body text-sm text-ink/60">{t('admin.moneyCheck.paid')}</p></div>
          <div className={card}><p className="font-heading text-xl font-bold"><Money cents={sum.marginCents} /></p><p className="font-body text-sm text-ink/60">{t('admin.moneyCheck.margin')}</p></div>
        </div>
        <label className="mb-3 flex items-center gap-2 font-body text-sm">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          {t('admin.moneyCheck.onlyFlagged')}
        </label>
        {shown.length === 0 ? <Empty title={onlyFlagged ? t('admin.moneyCheck.allGood') : t('admin.moneyCheck.none')} /> : (
          <ul className="flex flex-col gap-3" data-testid="money-check-rows">
            {shown.map((c) => (
              <li key={c.orderId} className={card}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-sm">
                  <Link className="font-semibold text-chilli underline" to={`/admin/orders/${c.orderId}`}>{c.number}</Link>
                  <Pill>{tStatus('order', c.status)}</Pill>
                  {c.flags.map((f) => (<Pill key={f} tone={FLAG_TONE[f]}>{t(`admin.moneyCheck.flag.${f}`)}</Pill>))}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-body text-sm sm:grid-cols-4">
                  <div><dt className="text-ink/60">{t('admin.moneyCheck.buyerPaid')}</dt><dd><Money cents={c.paidCents} /></dd></div>
                  <div><dt className="text-ink/60">{t('admin.moneyCheck.supplier')}</dt><dd><Money cents={c.supplierPayoutCents} /> <span className="text-ink/50">/ <Money cents={c.supplierExpectedCents} /></span></dd></div>
                  <div><dt className="text-ink/60">{t('admin.moneyCheck.driver')}</dt><dd><Money cents={c.driverPayoutCents} /> <span className="text-ink/50">/ <Money cents={c.driverExpectedCents} /></span></dd></div>
                  <div><dt className="text-ink/60">{t('admin.moneyCheck.kept')}</dt><dd><Money cents={c.marginCents} strong /> <span className="text-ink/50">({c.marginPct}%)</span></dd></div>
                </dl>
                {c.flags.length > 0 && (
                  <ul className="mt-3 list-disc pl-5 font-body text-xs text-ink/70">
                    {c.flags.map((f) => (<li key={f}>{t(`admin.moneyCheck.explain.${f}`)}</li>))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 font-body text-xs text-ink/50">{t('admin.moneyCheck.note')}</p>
      </LoadState>
    </AdminLayout>
  );
}
