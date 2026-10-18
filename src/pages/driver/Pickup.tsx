import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DashboardShell } from '../../components/DashboardShell';
import { PageSpinner } from '../../components/PageSpinner';
import { FormError } from '../../components/FormField';
import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthContext';
import { useSupabaseQuery } from '../../lib/useQuery';
import { Card, FileField, Pill } from '../supplier-driver-shared/ui';
import { uploadFile } from '../supplier-driver-shared/storage';
import { t } from '../supplier-driver-shared/t';
import { permitRemaining } from '../supplier/permit';
import { TemperatureCard } from './TemperatureCard';
import { DriverNav } from './DriverNav';
import { OfflineBanner } from './OfflineBanner';
import { useOfflineQueue } from './useOfflineQueue';
import { getOfflineQueue } from './offlineQueue';
import { confirmPickup, getHeatThreshold, getPickupInfo, getTrip, getTripStops } from './data';
import { birdsPerCrateLimit, HEAT_THRESHOLD_C, maxBirdsOnLoad, pickupBlockers } from './rules';
import { looksOffline } from './sync';
import type { DriverTrip, PickupInfo, TripStops } from './types';

export default function DriverPickup() {
  const { id = '' } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queue = useOfflineQueue();
  const trip = useSupabaseQuery<DriverTrip>(() => getTrip(id), [id]);
  const info = useSupabaseQuery<PickupInfo>(() => getPickupInfo(id), [id]);
  const [count, setCount] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const i = info.data;
  const stops = useSupabaseQuery<TripStops[]>(() => getTripStops(), [id]);
  const heat = useSupabaseQuery<{ key: string; value: unknown }>(() => getHeatThreshold(), []);
  const [tempNow, setTempNow] = useState<number | null>(null);
  const threshold = typeof heat.data?.value === 'number' ? heat.data.value : HEAT_THRESHOLD_C;
  const stop = (stops.data ?? []).find((x) => x.trip_id === id);
  const forecast = tempNow ?? trip.data?.forecast_temp_c ?? null;
  const { limit, hot } = birdsPerCrateLimit({ max_per_crate: i?.max_per_crate ?? null, max_per_crate_hot: i?.max_per_crate_hot ?? null }, forecast, threshold);
  const maxBirds = maxBirdsOnLoad(limit, i?.crates ?? null);
  const permit = permitRemaining(i?.permit_valid_until);
  const blockers = i
    ? pickupBlockers({
        count: Number(count) || 0,
        maxBirds,
        photoRequired: i.disinfection_photo_required,
        hasPhoto: !!photo,
        crossesProvince: i.crosses_province,
        hasMovementPermit: i.has_movement_permit,
        hasRemovalPermit: i.has_removal_permit,
        permitExpired: permit?.expired ?? true,
      })
    : ['driver.pickup.loading'];

  async function confirm() {
    if (!profile) return;
    setMsg(null);
    const n = Number(count);
    const queueIt = async () => {
      await getOfflineQueue().enqueue('pickup', id, { count: n }, photo);
      navigate('/driver/trips');
    };
    if (!navigator.onLine) return queueIt();
    let photoPath: string | null = null;
    if (photo) {
      const up = await uploadFile(photo, profile.id, 'disinfection');
      if (!up.path) return looksOffline(up.error ?? '') ? queueIt() : setMsg(up.error);
      photoPath = up.path;
    }
    const { error } = await confirmPickup({ p_trip_id: id, p_count: n, p_photo_path: photoPath });
    if (error) return looksOffline(error.message) ? queueIt() : setMsg(error.message);
    navigate('/driver/trips');
  }

  return (
    <DashboardShell roleLabel={t('driver.role')}>
      <DriverNav />
      <OfflineBanner online={queue.online} pending={queue.pending} syncing={queue.syncing} />
      <Link to="/driver/trips" className="font-body text-sm font-semibold text-chilli underline">{t('driver.back')}</Link>
      <h1 className="mt-2 font-heading text-2xl font-bold">{t('driver.pickup.title')}</h1>
      {(trip.loading || info.loading) && <PageSpinner label={t('common.loading')} />}
      {(trip.error || info.error) && <FormError message={(trip.error ?? info.error)?.message ?? null} />}
      <FormError message={msg} />

      {i && (
        <div className="mt-6 grid gap-4 landscape:grid-cols-2 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Card title={t('driver.pickup.permit')}>
              {i.permit_valid_until ? (
                <>
                  <p className="font-heading text-xl font-bold">
                    {t('driver.pickup.valid_until', { when: new Date(i.permit_valid_until).toLocaleString('en-ZA') })}
                  </p>
                  <Pill tone={permit?.expired ? 'bad' : permit?.urgency === 'warn' ? 'warn' : 'good'}>
                    {permit?.expired ? t('driver.pickup.permit_expired') : t('driver.pickup.permit_ok')}
                  </Pill>
                </>
              ) : (
                <p className="font-body text-chilli">{t('driver.pickup.no_permit')}</p>
              )}
            </Card>

            {trip.data && (
              <TemperatureCard tripId={id} lat={stop?.pickup_lat ?? null} lng={stop?.pickup_lng ?? null} current={forecast} onTemp={(c) => setTempNow(c)} />
            )}

            {isFinite(forecast ?? NaN) && forecast != null && (
              <div
                role={hot ? 'alert' : 'status'}
                data-testid="heat-banner"
                className={`rounded-2xl p-4 font-body ${hot ? 'bg-chilli text-cream' : 'bg-white'}`}
              >
                <p className="font-heading text-xl font-bold">{t('driver.pickup.forecast', { temp: forecast })}</p>
                {hot && <p className="mt-1 text-base font-semibold">{t('driver.pickup.heat_warning', { threshold })}</p>}
              </div>
            )}

            <Card title={t('driver.pickup.crate_limit')}>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className={`rounded-xl p-3 ${!hot ? 'bg-mustard/40 ring-2 ring-mustard' : 'bg-cream'}`}>
                  <p className="font-body text-xs uppercase">{t('driver.pickup.normal')}</p>
                  <p className="font-heading text-3xl font-bold">{i.max_per_crate ?? '-'}</p>
                </div>
                <div className={`rounded-xl p-3 ${hot ? 'bg-chilli/15 ring-2 ring-chilli' : 'bg-cream'}`}>
                  <p className="font-body text-xs uppercase">{t('driver.pickup.hot')}</p>
                  <p className="font-heading text-3xl font-bold">{i.max_per_crate_hot ?? i.max_per_crate ?? '-'}</p>
                </div>
              </div>
              {maxBirds != null && <p className="mt-3 font-body text-sm">{t('driver.pickup.max_load', { birds: maxBirds, crates: i.crates ?? 0 })}</p>}
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            {i.crosses_province && (
              <div role="alert" className={`rounded-2xl p-4 font-body ${i.has_movement_permit ? 'bg-mustard/30' : 'bg-chilli/15 text-chilli'}`}>
                <p className="font-semibold">{t('driver.pickup.province_cross')}</p>
                <p className="text-sm">{i.has_movement_permit ? t('driver.pickup.movement_ok') : t('driver.pickup.movement_missing')}</p>
              </div>
            )}
            {i.disinfection_photo_required && (
              <Card title={t('driver.pickup.disinfection')}>
                <FileField label={t('driver.pickup.disinfection_photo')} capture="environment" done={!!photo} onFile={setPhoto} />
              </Card>
            )}
            <Card title={t('driver.pickup.count_title')}>
              <input
                inputMode="numeric"
                aria-label={t('driver.pickup.count_title')}
                value={count}
                placeholder={i.expected_birds?.toString() ?? ''}
                onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
                className="min-h-16 w-full rounded-xl border border-ink/20 bg-white px-3 text-center font-heading text-4xl"
              />
              {blockers.length > 0 && (
                <ul className="mt-3 list-disc pl-5 font-body text-sm text-chilli">
                  {blockers.map((k) => (<li key={k}>{t(k)}</li>))}
                </ul>
              )}
              <Button className="mt-3 min-h-16 w-full text-lg" disabled={blockers.length > 0} onClick={() => void confirm()}>
                {t('driver.pickup.confirm')}
              </Button>
            </Card>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
