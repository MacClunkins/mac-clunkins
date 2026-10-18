import { useEffect, useState } from 'react';
import { DashboardShell } from '../../components/DashboardShell';
import { PageSpinner } from '../../components/PageSpinner';
import { FormError, SelectField, TextField } from '../../components/FormField';
import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthContext';
import { useSupabaseQuery } from '../../lib/useQuery';
import { Card, Check, FileField, NumberField, Pill } from '../supplier-driver-shared/ui';
import { openDocument, uploadFile } from '../supplier-driver-shared/storage';
import { t } from '../supplier-driver-shared/t';
import { DriverNav } from './DriverNav';
import { getDriverVehicle, listDriverDocuments, listRequirementSummaries, saveDriverDocument, saveDriverVehicle } from './data';
import { meetsRequirement } from './rules';
import { DRIVER_DOCS, VEHICLE_TYPES, type DriverDoc, type DriverVehicle, type SupplierRequirementSummary } from './types';

const EMPTY: DriverVehicle = { vehicle_type: null, gvm_kg: null, vehicle_reg: '', covered: false, ventilated: false, crates_owned: null, capacity_birds: null };
const num = (s: string) => (s === '' ? null : Number(s));

export default function DriverOnboarding() {
  const { profile } = useAuth();
  const [tick, setTick] = useState(0);
  const vehicle = useSupabaseQuery<DriverVehicle>(() => getDriverVehicle(), []);
  const docs = useSupabaseQuery<DriverDoc[]>(() => listDriverDocuments(), [tick]);
  const reqs = useSupabaseQuery<SupplierRequirementSummary[]>(() => listRequirementSummaries(), []);
  const [v, setV] = useState<DriverVehicle>(EMPTY);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (vehicle.data) setV({ ...EMPTY, ...vehicle.data }); }, [vehicle.data]);
  const set = <K extends keyof DriverVehicle>(k: K, val: DriverVehicle[K]) => setV((x) => ({ ...x, [k]: val }));

  async function saveVehicle() {
    if (!profile) return;
    setMsg(null);
    setSaved(false);
    const { error } = await saveDriverVehicle(profile.id, v);
    if (error) setMsg(error.message);
    else setSaved(true);
  }

  async function uploadDoc(kind: string, file: File) {
    if (!profile) return;
    setMsg(null);
    const up = await uploadFile(file, profile.id, `compliance/${kind}`);
    if (!up.path) return setMsg(up.error);
    const existing = docs.data?.find((d) => d.kind === kind);
    const { error } = await saveDriverDocument(profile.id, kind, existing?.id ?? null, up.path, null);
    if (error) setMsg(error.message);
    else setTick((n) => n + 1);
  }

  return (
    <DashboardShell roleLabel={t('driver.role')}>
      <DriverNav />
      <h1 className="font-heading text-2xl font-bold">{t('driver.onb.title')}</h1>
      <p className="mt-1 font-body text-sm text-ink/60">{t('driver.onb.subtitle')}</p>
      {(vehicle.loading || docs.loading) && <PageSpinner label={t('common.loading')} />}
      <FormError message={msg} />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={t('driver.onb.vehicle')}>
          <div className="flex flex-col gap-3">
            <SelectField id="vtype" label={t('driver.onb.vehicle_type')} value={v.vehicle_type ?? ''} onChange={(e) => set('vehicle_type', (e.target.value || null) as DriverVehicle['vehicle_type'])}>
              <option value="">{t('driver.onb.choose')}</option>
              {VEHICLE_TYPES.map((x) => (<option key={x} value={x}>{t(`vehicle.${x}`)}</option>))}
            </SelectField>
            <TextField id="reg" label={t('driver.onb.reg')} value={v.vehicle_reg ?? ''} onChange={(e) => set('vehicle_reg', e.target.value)} />
            <NumberField id="gvm" label={t('driver.onb.gvm')} value={v.gvm_kg?.toString() ?? ''} onChange={(x) => set('gvm_kg', num(x))} />
            <NumberField id="crates" label={t('driver.onb.crates')} value={v.crates_owned?.toString() ?? ''} onChange={(x) => set('crates_owned', num(x))} />
            <NumberField id="cap" label={t('driver.onb.capacity')} value={v.capacity_birds?.toString() ?? ''} onChange={(x) => set('capacity_birds', num(x))} />
            <Check id="covered" label={t('driver.onb.covered')} checked={v.covered} onChange={(x) => set('covered', x)} />
            <Check id="vent" label={t('driver.onb.ventilated')} checked={v.ventilated} onChange={(x) => set('ventilated', x)} />
            <Button className="min-h-14" onClick={() => void saveVehicle()}>{t('common.save')}</Button>
            {saved && <p role="status" className="font-body text-sm text-green-700">{t('common.saved')}</p>}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card title={t('driver.onb.docs')}>
            <ul className="flex flex-col gap-4">
              {DRIVER_DOCS.map((kind) => {
                const d = docs.data?.find((x) => x.kind === kind);
                const status = d?.status ?? 'missing';
                return (
                  <li key={kind} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-body text-sm font-semibold">{t(`doc.${kind}`)}</span>
                      <Pill tone={status === 'approved' ? 'good' : status === 'rejected' ? 'bad' : status === 'uploaded' ? 'warn' : 'neutral'}>{t(`doc.status.${status}`)}</Pill>
                    </div>
                    {d?.file_path && (
                      <Button variant="secondary" type="button" className="min-h-12" onClick={() => void openDocument(d.file_path as string).then((e) => e && setMsg(e))}>
                        {t('driver.onb.view_doc', { doc: t(`doc.${kind}`) })}
                      </Button>
                    )}
                    <FileField label={t('driver.onb.upload')} accept="image/*,application/pdf" done={status === 'uploaded' || status === 'approved'} onFile={(f) => void uploadDoc(kind, f)} />
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title={t('driver.onb.fit_title')}>
            {(reqs.data ?? []).length === 0 && <p className="font-body text-sm text-ink/60">{t('driver.onb.fit_none')}</p>}
            <ul className="flex flex-col gap-3">
              {(reqs.data ?? []).map((r) => {
                const fit = meetsRequirement(v, r);
                return (
                  <li key={r.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-body text-sm font-semibold">{r.label}</span>
                      <Pill tone={fit.ok ? 'good' : 'bad'}>{fit.ok ? t('driver.onb.fit_ok') : t('driver.onb.fit_no')}</Pill>
                    </div>
                    {fit.reasons.map((k) => (<span key={k} className="font-body text-xs text-chilli">{t(k)}</span>))}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
