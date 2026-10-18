import { Link, useParams } from 'react-router-dom';
import { FormError } from '../../components/FormField';
import { PageSpinner } from '../../components/PageSpinner';
import { getOrder, getTracking } from './api';
import { BuyerLayout, Card } from './components/BuyerLayout';
import { DeliveryCode } from './components/DeliveryCode';
import { BuyerMap } from './components/MapPlaceholder';
import { useAsync } from './hooks/useAsync';
import { t } from './i18n-shim';
import { formatTime } from './lib/dates';
import type { TrackingInfo } from './types';

/** Defence in depth: whatever the server sends, the buyer only ever sees a first name. */
export function firstName(full: string | null): string | null {
  const f = full?.trim().split(/\s+/)[0];
  return f ? f : null;
}

export default function Track() {
  const { id = '' } = useParams();
  const order = useAsync(() => getOrder(id), [id]);
  const tracking = useAsync(() => getTracking(id), [id]);

  const loading = order.loading || tracking.loading;
  const info: TrackingInfo | null = tracking.data;
  const driver = firstName(info?.driver_first_name ?? null);

  return (
    <BuyerLayout>
      <h1 className="mb-5 font-heading text-2xl font-bold">{t('buyer.track.title')}</h1>
      {loading && <PageSpinner label={t('buyer.track.loading')} />}
      <FormError message={order.error || tracking.error ? t('buyer.track.loadError') : null} />

      {!loading && order.data && (
        <div className="flex flex-col gap-4">
          <BuyerMap
            center={info && info.lat !== null && info.lng !== null ? { lat: info.lat, lng: info.lng } : null}
          />

          <Card>
            <p className="text-sm text-ink/60">{info?.eta_source === 'window' ? t('buyer.track.etaWindow') : t('buyer.track.eta')}</p>
            <p className="font-heading text-2xl font-bold" data-testid="eta">
              {info?.eta_at ? formatTime(info.eta_at) : t('buyer.track.etaPending')}
            </p>
          </Card>

          <Card>
            <h2 className="font-heading font-bold">{t('buyer.track.driverTitle')}</h2>
            {driver ? (
              <p className="mt-1">
                <span data-testid="driver-name">{driver}</span>
                {info?.vehicle ? ` · ${info.vehicle}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink/60">{t('buyer.track.driverPending')}</p>
            )}
            {info?.call_number && driver && (
              <>
                <a
                  href={`tel:${info.call_number}`}
                  className="mt-3 inline-block rounded-full bg-chilli px-5 py-2 font-semibold text-cream"
                >
                  {t('buyer.track.call')}
                </a>
                <p className="mt-1 text-xs text-ink/60">{t('buyer.track.callMasked')}</p>
              </>
            )}
          </Card>

          <Card>
            <DeliveryCode code={order.data.delivery_code} />
          </Card>

          <Link to={`/orders/${id}`} className="font-semibold text-chilli">
            {t('buyer.track.backToOrder')}
          </Link>
        </div>
      )}
    </BuyerLayout>
  );
}
