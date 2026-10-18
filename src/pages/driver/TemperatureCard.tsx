import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../supplier-driver-shared/ui';
import { t } from '../supplier-driver-shared/t';
import { recordTemperature } from './data';
import { currentTempFrom, forecastUrl, parseTemperature } from './rules';

/**
 * Where the pickup temperature comes from. The phone asks a free weather service for the forecast at the farm and
 * saves it; the driver can type a thermometer reading, which replaces it. The hot-day crate limit follows this number.
 */
export function TemperatureCard({ tripId, lat, lng, current, onTemp }: {
  tripId: string; lat: number | null; lng: number | null; current: number | null; onTemp: (c: number, source: 'forecast' | 'measured') => void;
}) {
  const [text, setText] = useState('');
  const [source, setSource] = useState<'forecast' | 'measured' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  // Fetch the forecast once, if nothing is recorded yet. A failure is not an error: the driver can type a reading.
  useEffect(() => {
    if (asked.current || current !== null || lat == null || lng == null) return;
    asked.current = true;
    const controller = new AbortController();
    fetch(forecastUrl(lat, lng), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (json) => {
        const c = currentTempFrom(json);
        if (c === null) return;
        const { error } = await recordTemperature({ p_trip_id: tripId, p_temp_c: c, p_source: 'forecast' });
        if (!error) { setSource('forecast'); onTemp(c, 'forecast'); }
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, lat, lng, current]);

  async function save() {
    const c = parseTemperature(text);
    if (c === null) return setMsg(t('driver.temp.invalid'));
    setBusy(true);
    setMsg(null);
    const { error } = await recordTemperature({ p_trip_id: tripId, p_temp_c: c, p_source: 'measured' });
    setBusy(false);
    if (error) return setMsg(error.message);
    setSource('measured');
    setText('');
    onTemp(c, 'measured');
  }

  return (
    <Card title={t('driver.temp.title')}>
      <p className="font-heading text-3xl font-bold" data-testid="temp-value">{current !== null ? `${current}°C` : '–'}</p>
      <p className="font-body text-xs text-ink/60">
        {source ? t(`driver.temp.source.${source}`) : current !== null ? t('driver.temp.saved') : t('driver.temp.none')}
      </p>
      <label className="mt-3 flex flex-col gap-1 font-body text-sm">
        {t('driver.temp.measured')}
        <input inputMode="decimal" aria-label={t('driver.temp.measured')} value={text} onChange={(e) => setText(e.target.value)} className="min-h-12 rounded-xl border border-ink/20 bg-white px-3" />
      </label>
      {msg && <p role="alert" className="mt-1 font-body text-sm text-chilli">{msg}</p>}
      <Button className="mt-2 min-h-12 w-full" variant="secondary" disabled={busy || !text.trim()} onClick={() => void save()}>{t('driver.temp.save')}</Button>
      <p className="mt-2 font-body text-xs text-ink/60">{t('driver.temp.help')}</p>
    </Card>
  );
}
