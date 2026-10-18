import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DashboardShell, EmptyState } from '../../components/DashboardShell';
import { PageSpinner } from '../../components/PageSpinner';
import { FormError } from '../../components/FormField';
import { Button } from '../../components/Button';
import { formatCents } from '../../lib/format';
import { useSupabaseQuery } from '../../lib/useQuery';
import { Card, FileField, Pill, Stat } from '../supplier-driver-shared/ui';
import { uploadFile } from '../supplier-driver-shared/storage';
import { t } from '../supplier-driver-shared/t';
import { useAuth } from '../../auth/AuthContext';
import { DriverNav } from './DriverNav';
import { OfflineBanner } from './OfflineBanner';
import { useOfflineQueue } from './useOfflineQueue';
import { getOfflineQueue } from './offlineQueue';
import { confirmDelivery, getSupportPhone, getTripStops, listTrips } from './data';
import { currentTrip, earnedOn } from './earned';
import { isValidDeliveryCode, navigateUrl } from './rules';
import { looksOffline } from './sync';
import { useShareLocation } from './useShareLocation';
import type { DriverTrip, TripStops } from './types';

function MapPane({ lat, lng }: { lat: number | null; lng: number | null }) {
  if (lat == null || lng == null) {
    return <div className="flex h-full min-h-64 items-center justify-center rounded-2xl bg-ink/5 font-body text-ink/60">{t('driver.trips.no_map')}</div>;
  }
  const d = 0.01;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  return <iframe title={t('driver.trips.map')} src={src} className="h-full min-h-64 w-full rounded-2xl border-0" loading="lazy" />;
}

export default function DriverTrips() {
  const { profile } = useAuth();
  const queue = useOfflineQueue();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const trips = useSupabaseQuery<DriverTrip[]>(() => listTrips(), [tick]);
  const stops = useSupabaseQuery<TripStops[]>(() => getTripStops(), [tick]);
  const phone = useSupabaseQuery<{ key: string; value: unknown }>(() => getSupportPhone(), []);
  const [code, setCode] = useState('');
  const [count, setCount] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState(false);

  const all = trips.data ?? [];
  const current = currentTrip(all);
  const stop = current ? (stops.data ?? []).find((s) => s.trip_id === current.id) : undefined;
  const upcoming = all.filter((x) => x.status === 'assigned' && x.id !== current?.id);
  const supportPhone = typeof phone.data?.value === 'string' ? phone.data.value : null;
  const toDrop = current?.status === 'picked_up';
  useShareLocation(toDrop ? current?.id : null);
  const nav = stop
    ? toDrop
      ? navigateUrl(stop.drop_lat, stop.drop_lng, stop.drop_address)
      : navigateUrl(stop.pickup_lat, stop.pickup_lng, stop.pickup_address)
    : null;

  async function deliver() {
    if (!current || !profile) return;
    setMsg(null);
    setQueuedNote(false);
    if (!isValidDeliveryCode(code)) return setMsg(t('driver.trips.code_invalid'));
    const n = Number(count || stop?.expected_birds || 0);
    if (!(n > 0)) return setMsg(t('driver.trips.count_required'));

    const queueIt = async () => {
      await getOfflineQueue().enqueue('delivery', current.id, { code, count: n }, photo);
      setQueuedNote(true);
      setCode('');
      setTick((n) => n + 1);
    };

    if (!navigator.onLine) return queueIt();
    let photoPath: string | null = null;
    if (photo) {
      const up = await uploadFile(photo, profile.id, 'pod');
      if (!up.path) return looksOffline(up.error ?? '') ? queueIt() : setMsg(up.error);
      photoPath = up.path;
    }
    const { error } = await confirmDelivery({ p_trip_id: current.id, p_code: code, p_count: n, p_photo_path: photoPath });
    if (error) {
      if (looksOffline(error.message)) return queueIt();
      return setMsg(t('driver.trips.code_rejected'));
    }
    navigate(`/driver/trips/${current.id}/done`);
  }

  return (
    <DashboardShell roleLabel={t('driver.role')}>
      <DriverNav />
      <OfflineBanner online={queue.online} pending={queue.pending} syncing={queue.syncing} />
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold">{t('driver.trips.title')}</h1>
        <div className="w-40"><Stat label={t('driver.trips.earned_today')} value={formatCents(earnedOn(all, new Date()))} tone="chilli" /></div>
      </div>
      <p className="mt-1 font-body text-sm text-ink/60">{t('driver.trips.subtitle')}</p>
      {(trips.loading || stops.loading) && <PageSpinner label={t('driver.trips.loading')} />}
      {trips.error && <FormError message={t('driver.trips.load_error', { message: trips.error.message })} />}
      {!trips.loading && !trips.error && all.length === 0 && (
        <div className="mt-6"><EmptyState title={t('driver.trips.empty_title')} body={t('driver.trips.empty_body')} /></div>
      )}

      {current && (
        <div className="mt-6 grid gap-4 landscape:grid-cols-[3fr_2fr] lg:grid-cols-[3fr_2fr]">
          <div className="min-h-64 landscape:min-h-[60vh]">
            <MapPane lat={toDrop ? stop?.drop_lat ?? null : stop?.pickup_lat ?? null} lng={toDrop ? stop?.drop_lng ?? null : stop?.pickup_lng ?? null} />
          </div>
          <div className="flex flex-col gap-3">
            <Card title={t('driver.trips.current')}>
              <div className="flex items-center justify-between">
                <Pill tone={toDrop ? 'warn' : 'neutral'}>{t(`driver.status.${current.status}`)}</Pill>
                <span className="font-heading text-lg font-bold text-chilli">{t('driver.trips.fee', { fee: formatCents(current.driver_share_cents) })}</span>
              </div>
              <p className="mt-3 font-body text-base">
                {toDrop
                  ? t('driver.trips.drop_to', { name: stop?.buyer_first_name ?? '', address: stop?.drop_address ?? t('driver.trips.address_unknown') })
                  : t('driver.trips.pickup_from', { address: stop?.pickup_address ?? t('driver.trips.address_unknown') })}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {nav ? (
                  <a href={nav} target="_blank" rel="noreferrer" className="inline-flex min-h-16 items-center justify-center rounded-full bg-chilli px-5 font-body text-lg font-semibold text-cream">
                    {t('driver.trips.navigate')}
                  </a>
                ) : (
                  <span className="inline-flex min-h-16 items-center justify-center rounded-full bg-ink/10 font-body text-ink/50">{t('driver.trips.navigate')}</span>
                )}
                {supportPhone ? (
                  <a href={`tel:${supportPhone.replace(/\s/g, '')}`} className="inline-flex min-h-16 items-center justify-center rounded-full border border-ink/20 px-5 font-body text-lg font-semibold">
                    {t('driver.trips.call_mccluckins')}
                  </a>
                ) : (
                  <span className="inline-flex min-h-16 items-center justify-center rounded-full bg-ink/10 font-body text-ink/50">{t('driver.trips.call_mccluckins')}</span>
                )}
              </div>
              {!toDrop && (
                <Link to={`/driver/trips/${current.id}/pickup`} className="mt-3 inline-flex min-h-16 w-full items-center justify-center rounded-full bg-ink font-body text-lg font-semibold text-cream">
                  {t('driver.trips.start_pickup')}
                </Link>
              )}
            </Card>

            {toDrop && (
              <Card title={t('driver.trips.handover')}>
                <FormError message={msg} />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t('driver.trips.buyer_code')}</span>
                  <input
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    aria-label={t('driver.trips.buyer_code')}
                    className="min-h-16 rounded-xl border border-ink/20 bg-white text-center font-heading text-4xl tracking-[0.5em]"
                  />
                </label>
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t('driver.trips.count_handed')}</span>
                  <input
                    inputMode="numeric"
                    value={count}
                    placeholder={stop?.expected_birds?.toString() ?? ''}
                    onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
                    className="min-h-14 rounded-xl border border-ink/20 bg-white px-3 text-xl"
                  />
                </label>
                <div className="mt-3">
                  <FileField label={t('driver.trips.pod_photo')} capture="environment" done={!!photo} onFile={setPhoto} />
                </div>
                <Button className="mt-3 min-h-16 w-full text-lg" onClick={() => void deliver()}>
                  {t('driver.trips.confirm_delivery')}
                </Button>
                {queuedNote && <p role="status" className="mt-2 font-body text-sm font-semibold text-ink">{t('driver.trips.queued')}</p>}
              </Card>
            )}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-heading text-lg font-bold">{t('driver.trips.upcoming')}</h2>
          <ul className="flex flex-col gap-3">
            {upcoming.map((u) => {
              const s = (stops.data ?? []).find((x) => x.trip_id === u.id);
              return (
                <li key={u.id} className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
                  <div>
                    <p className="font-heading font-bold">{s?.slot_label ?? t('driver.trips.slot_unset')}</p>
                    <p className="font-body text-sm text-ink/60">{s?.drop_address ?? t('driver.trips.address_unknown')}</p>
                  </div>
                  <p className="font-heading font-bold text-chilli">{t('driver.trips.fee', { fee: formatCents(u.driver_share_cents) })}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </DashboardShell>
  );
}
