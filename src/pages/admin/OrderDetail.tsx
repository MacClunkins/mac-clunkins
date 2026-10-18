import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import {
  assignDriver, assignSupplier, loadDriverOptions, loadOrderDetail, loadSlots, matchSuppliers,
  rematchOrder, scheduleOrder, type OrderDetail as Detail,
} from './api';
import { useAdminData } from './hooks/useAdminData';
import { useSettings } from './hooks/useSettings';
import { driverFitProblems } from './logic/drivers';
import { formatJourney, isEligible, rankCandidates } from './logic/matching';
import { driverShareCents, evaluateRematch } from './logic/money';
import { breakdownInput, orderMoney } from './logic/orderMoney';
import { MoneyBreakdown } from './MoneyBreakdown';
import { RecordPayment } from './RecordPayment';
import type { AllocationRow, MatchCandidate } from './types';
import { t } from './i18n';
import {
  AdminLayout, DataTable, Empty, LoadState, Money, Pill, SectionTitle, card, displayName, errorText,
  formatDate, formatDateTime, input, tStatus, useConfirm,
} from './ui';

export default function AdminOrderDetail() {
  const { id = '' } = useParams();
  const { data, loading, error, reload } = useAdminData(() => loadOrderDetail(id), [id]);
  return (
    <AdminLayout
      title={data ? t('admin.order.title', { number: data.order.number }) : t('admin.order.titleLoading')}
      subtitle={data ? `${displayName(data.order.buyer)} - ${data.order.address?.town ?? ''} ${data.order.address?.province ?? ''}` : undefined}
      actions={<Link to="/admin/orders" className="font-body text-sm font-semibold text-chilli hover:underline">&larr; {t('admin.nav.orders')}</Link>}
    >
      <LoadState loading={loading} error={error} hasData={!!data}>
        {data && <Body detail={data} reload={reload} />}
      </LoadState>
    </AdminLayout>
  );
}

function Body({ detail, reload }: { detail: Detail; reload: () => void }) {
  const { order, allocations, trips, payments, events } = detail;
  const settings = useSettings();
  const sharePct = settings.num('driver_share_pct', 85);
  const heatC = settings.num('heat_warn_c', 30);
  const money = orderMoney(order, allocations, trips, payments);
  const active = allocations.filter((a) => a.status !== 'declined');
  const [msg, setMsg] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  async function act(p: Promise<{ error: { message: string; code?: string } | null }>) {
    const r = await p;
    setMsg(errorText(r.error));
    if (!r.error) reload();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="flex flex-col gap-6 xl:col-span-2">
        <FormError message={msg} />
        <Matching detail={detail} active={active} onAct={act} ask={ask} sharePct={sharePct} />
        <ScheduleCard detail={detail} onAct={act} />
        <section className={card}>
          <SectionTitle>{t('admin.order.drivers')}</SectionTitle>
          {active.length === 0 ? <p className="font-body text-sm text-ink/60">{t('admin.order.noAllocation')}</p> : (
            <div className="flex flex-col gap-4">
              {active.map((a) => (
                <DriverPicker key={a.id} allocation={a} detail={detail} heatC={heatC} onAct={act} />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-6">
        <RecordPayment orderId={order.id} status={order.status} totalCents={order.total_cents} onDone={reload} />
        <section className={card}>
          <SectionTitle>{t('admin.order.money')}</SectionTitle>
          <MoneyBreakdown order={order} breakdown={money.breakdown} feeEstimated={money.feeEstimated} incomplete={money.incomplete} />
          <p className="mt-3 font-body text-xs text-ink/50">{t('admin.order.moneyNote')}</p>
        </section>
        <section className={card}>
          <SectionTitle>{t('admin.order.timeline')}</SectionTitle>
          {events.length === 0 ? <p className="font-body text-sm text-ink/60">{t('admin.order.timelineEmpty')}</p> : (
            <ol className="flex flex-col gap-3 border-l-2 border-ink/10 pl-4">
              {events.map((e) => (
                <li key={e.id} className="font-body text-sm">
                  <Pill>{tStatus('order', e.status)}</Pill>
                  <span className="ml-2 text-xs text-ink/50">{formatDateTime(e.created_at)} - {e.actor?.full_name ?? t('admin.order.system')}</span>
                  {e.note && <p className="mt-1 text-ink/70">{e.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      {dialog}
    </div>
  );
}

type Act = (p: Promise<{ error: { message: string; code?: string } | null }>) => Promise<void>;
type Ask = ReturnType<typeof useConfirm>['ask'];

function Matching({ detail, active, onAct, ask, sharePct }: { detail: Detail; active: AllocationRow[]; onAct: Act; ask: Ask; sharePct: number }) {
  const { order, allocations, trips, payments } = detail;
  const { data, loading, error } = useAdminData(() => matchSuppliers(order.id), [order.id, allocations.length]);
  const ranked = useMemo(() => rankCandidates(data ?? []), [data]);
  const current = active[0];
  const { input: bi } = breakdownInput(order, allocations, trips, payments);

  function choose(c: MatchCandidate) {
    if (!current) {
      ask({
        title: t('admin.match.assignTitle'), body: t('admin.match.assignBody', { name: c.supplier_name, count: order.quantity }),
        confirmLabel: t('admin.match.assign'), run: () => onAct(assignSupplier(order.id, c.supplier_id, order.quantity)),
      });
      return;
    }
    const share = c.est_delivery_fee_cents !== null ? driverShareCents(c.est_delivery_fee_cents, sharePct) : bi.driverShareCents;
    const ev = evaluateRematch(bi, { supplierCostCents: order.quantity * c.price_cents, driverShareCents: share });
    ask({
      title: t('admin.match.rematchTitle'),
      body: (
        <div className="flex flex-col gap-2">
          <p>{t(`admin.match.outcome.${ev.outcome}`)}</p>
          <p>{t('admin.match.newMargin')} <Money cents={ev.newMarginCents} strong /></p>
          {ev.outcome === 'full_refund' && <p className="font-semibold text-chilli">{t('admin.match.refundWarning')} <Money cents={order.total_cents} /></p>}
        </div>
      ),
      confirmLabel: ev.outcome === 'full_refund' ? t('admin.match.refundConfirm') : t('admin.match.rematchConfirm'),
      destructive: ev.outcome === 'full_refund',
      run: () => onAct(rematchOrder(order.id, c.supplier_id, ev.outcome)),
    });
  }

  return (
    <section className={card}>
      <SectionTitle>{t('admin.match.title')}</SectionTitle>
      {active.map((a) => (
        <p key={a.id} className="mb-3 font-body text-sm">
          {t('admin.match.current', { name: displayName(a.supplier), count: a.quantity })} <Pill>{tStatus('allocation', a.status)}</Pill>
          {a.crosses_province && !a.movement_permit_path && <Pill tone="bad">{t('admin.warn.movementPermit')}</Pill>}
        </p>
      ))}
      <LoadState loading={loading} error={error} hasData={!!data}>
        <DataTable
          rows={ranked}
          rowKey={(c) => c.supplier_id}
          empty={<Empty title={t('admin.match.none')} />}
          columns={[
            { key: 'n', header: t('admin.match.col.supplier'), render: (c) => <span className="font-semibold">{c.supplier_name}{c.same_province && <span className="ml-1 text-xs text-ink/50">{t('admin.match.sameProvince')}</span>}</span> },
            { key: 'd', header: t('admin.match.col.distance'), render: (c) => `${c.distance_km} km` },
            { key: 'j', header: t('admin.match.col.journey'), render: (c) => formatJourney(c.journey_minutes) },
            { key: 'p', header: t('admin.match.col.price'), render: (c) => <Money cents={c.price_cents} /> },
            { key: 'l', header: t('admin.match.col.landed'), render: (c) => <Money cents={c.landed_cents_per_bird} /> },
            { key: 's', header: t('admin.match.col.stock'), render: (c) => <span className={c.stock_available < order.quantity ? 'text-chilli' : ''}>{c.stock_available}</span> },
            { key: 'f', header: t('admin.match.col.fit'), render: (c) => <Pill tone={c.requirement_fit === 'ok' ? 'good' : c.requirement_fit === 'partial' ? 'warn' : 'bad'}>{t(`admin.match.fit.${c.requirement_fit}`)}</Pill> },
            { key: 'z', header: t('admin.match.col.zone'), render: (c) => <Pill tone={c.avian_flu_zone === 'none' ? 'good' : 'bad'}>{t(`admin.zone.${c.avian_flu_zone}`)}</Pill> },
            { key: 'a', header: '', render: (c) => (
              <Button variant="secondary" disabled={!isEligible(c) || c.supplier_id === current?.supplier_id || ['collected'].includes(current?.status ?? '')} onClick={() => choose(c)}>
                {current ? t('admin.match.rematch') : t('admin.match.assign')}
              </Button>
            ) },
          ]}
        />
        <ul className="mt-2 list-disc pl-5 font-body text-xs text-ink/50">
          {ranked.filter((c) => c.requirement_notes.length).map((c) => <li key={c.supplier_id}>{c.supplier_name}: {c.requirement_notes.join('; ')}</li>)}
        </ul>
      </LoadState>
    </section>
  );
}

function ScheduleCard({ detail, onAct }: { detail: Detail; onAct: Act }) {
  const { order, allocations, supplierDetails } = detail;
  const slots = useAdminData(loadSlots, []);
  const [date, setDate] = useState(order.delivery_date ?? '');
  const [slot, setSlot] = useState(order.slot_id ?? '');
  const crossing = allocations.filter((a) => a.crosses_province && !a.movement_permit_path);
  const flu = allocations.filter((a) => (supplierDetails[a.supplier_id]?.avian_flu_zone ?? 'none') !== 'none');
  const canSchedule = !!date && !!slot && allocations.length > 0 && crossing.length === 0 && flu.length === 0 && ['paid', 'scheduled'].includes(order.status);
  return (
    <section className={card}>
      <SectionTitle>{t('admin.schedule.card')}</SectionTitle>
      {order.delivery_date && <p className="mb-2 font-body text-sm">{t('admin.schedule.current', { date: formatDate(order.delivery_date), slot: order.slot?.label ?? '' })}</p>}
      {crossing.length > 0 && <p role="alert" className="mb-2 rounded-lg bg-chilli/10 px-3 py-2 font-body text-sm text-chilli">{t('admin.warn.movementPermitBlock')}</p>}
      {flu.length > 0 && <p role="alert" className="mb-2 rounded-lg bg-chilli/10 px-3 py-2 font-body text-sm text-chilli">{t('admin.warn.birdFluBlock')}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-body text-sm">{t('admin.schedule.date')}<input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="flex flex-col gap-1 font-body text-sm">{t('admin.schedule.slot')}
          <select className={input} value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="">{t('admin.common.choose')}</option>
            {(slots.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <Button disabled={!canSchedule} onClick={() => void onAct(scheduleOrder(order.id, date, slot))}>{t('admin.schedule.save')}</Button>
      </div>
      <p className="mt-2 font-body text-xs text-ink/50">{t('admin.schedule.buyerNote')}</p>
    </section>
  );
}

function DriverPicker({ allocation, detail, heatC, onAct }: { allocation: AllocationRow; detail: Detail; heatC: number; onAct: Act }) {
  const trip = detail.trips.find((x) => x.allocation_id === allocation.id);
  const { data, loading, error } = useAdminData(() => loadDriverOptions(allocation.supplier_id), [allocation.supplier_id]);
  const [pick, setPick] = useState('');
  const hot = (trip?.forecast_temp_c ?? 0) > heatC;
  const options = (data ?? []).map((o) => ({ ...o, problems: driverFitProblems({ driver: o.driver, requirements: o.requirements, birds: allocation.quantity, hotDay: hot }) }));
  return (
    <div className="rounded-xl bg-cream p-4">
      <p className="font-body text-sm font-semibold">{displayName(allocation.supplier)} - {allocation.quantity} {t('admin.common.birds')}</p>
      <p className="font-body text-sm text-ink/70">{trip?.driver_id ? t('admin.order.driverAssigned', { name: displayName(trip.driver) }) : t('admin.order.driverNone')}</p>
      <LoadState loading={loading} error={error} hasData={!!data}>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select className={input} aria-label={t('admin.order.pickDriver')} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t('admin.common.choose')}</option>
            {options.map((o) => (
              <option key={o.driver.profile_id} value={o.driver.profile_id} disabled={o.problems.length > 0}>
                {displayName(o.driver.profile)} ({o.driver.capacity_birds ?? '?'}){o.problems.length ? ` - ${o.problems.map((p) => t(`admin.driverProblem.${p}`)).join(', ')}` : ''}
              </option>
            ))}
          </select>
          <Button disabled={!pick || trip?.driver_id === pick} onClick={() => void onAct(assignDriver(allocation.id, pick))}>{t('admin.order.assignDriver')}</Button>
        </div>
      </LoadState>
    </div>
  );
}
