import type { Breakdown } from './logic/money';
import { t } from './i18n';
import { Money, StatLine } from './ui';

/** Order money in cents: what the buyer pays, what leaves, and what McCluckin's keeps. */
export function MoneyBreakdown({ order, breakdown, feeEstimated, incomplete }: {
  order: { delivery_fee_cents: number; service_fee_cents: number };
  breakdown: Breakdown;
  feeEstimated?: boolean;
  incomplete?: boolean;
}) {
  return (
    <div>
      <StatLine label={t('admin.money.birds')}><Money cents={breakdown.buyerPaysCents - order.delivery_fee_cents - order.service_fee_cents} /></StatLine>
      <StatLine label={t('admin.money.delivery')}><Money cents={order.delivery_fee_cents} /></StatLine>
      <StatLine label={t('admin.money.serviceFee')}><Money cents={order.service_fee_cents} /></StatLine>
      <StatLine label={t('admin.money.buyerPays')} strong><Money cents={breakdown.buyerPaysCents} /></StatLine>
      <div className="my-2" />
      <StatLine label={t('admin.money.supplierCost')}>&minus;<Money cents={breakdown.supplierCostCents} /></StatLine>
      <StatLine label={t('admin.money.driverShare')}>&minus;<Money cents={breakdown.driverShareCents} /></StatLine>
      <StatLine label={feeEstimated ? t('admin.money.paystackFeeEst') : t('admin.money.paystackFee')}>&minus;<Money cents={breakdown.paystackFeeCents} /></StatLine>
      <StatLine label={t('admin.money.transferFees')}>&minus;<Money cents={breakdown.transferFeesCents} /></StatLine>
      <StatLine label={t('admin.money.margin')} strong>
        <span className={breakdown.marginCents < 0 ? 'text-chilli' : ''}>
          <Money cents={breakdown.marginCents} strong /> <span className="font-normal text-ink/50">({breakdown.marginPct}%)</span>
        </span>
      </StatLine>
      {incomplete && <p className="mt-2 font-body text-xs text-ink/50">{t('admin.money.incomplete')}</p>}
    </div>
  );
}
