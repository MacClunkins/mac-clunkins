import { useEffect, useState } from 'react';
import { DashboardShell } from '../../components/DashboardShell';
import { PageSpinner } from '../../components/PageSpinner';
import { FormError, SelectField, TextField } from '../../components/FormField';
import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthContext';
import { useSupabaseQuery } from '../../lib/useQuery';
import { Card, FileField, Pill } from '../supplier-driver-shared/ui';
import { openDocument, uploadFile } from '../supplier-driver-shared/storage';
import { t } from '../supplier-driver-shared/t';
import { SupplierNav } from './SupplierNav';
import { approvalState, isExpired, REQUIRED_SUPPLIER_DOCS } from './logic';
import { getSupplierDetails, listDocuments, listProvinces, saveDocument, saveSupplierDetails, saveSupplierLocation } from './data';
import type { ComplianceDoc, DocumentStatus, SupplierDetails } from './types';

const tone = (s: DocumentStatus, expired: boolean) =>
  expired || s === 'rejected' ? 'bad' : s === 'approved' ? 'good' : s === 'uploaded' ? 'warn' : 'neutral';

export default function SupplierOnboarding() {
  const { profile } = useAuth();
  const [tick, setTick] = useState(0);
  const docs = useSupabaseQuery<ComplianceDoc[]>(() => listDocuments(), [tick]);
  const details = useSupabaseQuery<SupplierDetails>(() => getSupplierDetails(), [tick]);
  const provinces = useSupabaseQuery<{ code: string; name: string }[]>(() => listProvinces(), []);
  const [farm, setFarm] = useState('');
  const [address, setAddress] = useState('');
  const [province, setProvince] = useState('');
  const [coords, setCoords] = useState<string | undefined>();
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);

  useEffect(() => {
    const d = details.data;
    if (d) {
      setFarm(d.farm_name ?? '');
      setAddress(d.pickup_address ?? '');
      setProvince(d.province ?? '');
    }
  }, [details.data]);

  const state = approvalState(docs.data ?? []);

  async function uploadDoc(kind: string, file: File) {
    if (!profile) return;
    setMsg(null);
    const up = await uploadFile(file, profile.id, `compliance/${kind}`);
    if (!up.path) return setMsg(up.error);
    const existing = docs.data?.find((d) => d.kind === kind);
    const { error } = await saveDocument(profile.id, kind, existing?.id ?? null, up.path, expiry[kind] || null);
    if (error) setMsg(error.message);
    else setTick((n) => n + 1);
  }

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      async (p) => {
        const loc = `SRID=4326;POINT(${p.coords.longitude} ${p.coords.latitude})`;
        setCoords(loc);
        setMsg(null);
        // Saved straight away when the farm record already exists; otherwise it is saved with Submit.
        if (profile) {
          const { error } = await saveSupplierLocation(profile.id, loc);
          if (!error) setLocationSaved(true);
        }
      },
      () => setMsg(t('supplier.onb.location_denied')),
    );
  }

  async function viewDoc(path: string) {
    setMsg(await openDocument(path));
  }

  async function submit() {
    if (!profile) return;
    setMsg(null);
    if (!farm || !address || !province) return setMsg(t('supplier.onb.farm_required'));
    // BACKEND DEPENDENCY: there is no `submitted` flag in the schema; admins review
    // from documents.status = 'uploaded'. This only saves the farm details.
    const { error } = await saveSupplierDetails(profile.id, { farm_name: farm, pickup_address: address, province, location: coords });
    if (error) setMsg(error.message);
    else {
      setSubmitted(true);
      setTick((n) => n + 1);
    }
  }

  const missing = REQUIRED_SUPPLIER_DOCS.filter((k) => {
    const d = docs.data?.find((x) => x.kind === k);
    return !d || d.status === 'missing' || d.status === 'rejected';
  }).length;

  return (
    <DashboardShell roleLabel={t('supplier.role')}>
      <SupplierNav />
      <h1 className="font-heading text-2xl font-bold">{t('supplier.onb.title')}</h1>
      <p className="mt-2" role="status">
        <Pill tone={state === 'approved' ? 'good' : state === 'expired' ? 'bad' : 'warn'}>{t(`supplier.onb.state.${state}`)}</Pill>
      </p>
      {state === 'expired' && <p className="mt-2 rounded-xl bg-chilli/10 p-3 font-body text-sm text-chilli">{t('supplier.onb.paused_expired')}</p>}
      {(docs.loading || details.loading) && <PageSpinner label={t('common.loading')} />}
      <FormError message={msg} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={t('supplier.onb.farm_title')}>
          <div className="flex flex-col gap-3">
            <TextField id="farm" label={t('supplier.onb.farm_name')} value={farm} onChange={(e) => setFarm(e.target.value)} />
            <TextField id="addr" label={t('supplier.onb.pickup_address')} value={address} onChange={(e) => setAddress(e.target.value)} />
            <SelectField id="prov" label={t('supplier.onb.province')} value={province} onChange={(e) => setProvince(e.target.value)}>
              <option value="">{t('supplier.onb.choose_province')}</option>
              {(provinces.data ?? []).map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </SelectField>
            <Button variant="secondary" className="min-h-12" type="button" onClick={useMyLocation}>
              {coords ? t('supplier.onb.location_set') : t('supplier.onb.use_location')}
            </Button>
            <p className="font-body text-xs text-ink/60">{locationSaved ? t('supplier.onb.location_saved') : t('supplier.onb.location_help')}</p>
          </div>
        </Card>

        <Card title={t('supplier.onb.docs_title')}>
          <ul className="flex flex-col gap-4">
            {REQUIRED_SUPPLIER_DOCS.map((kind) => {
              const d = docs.data?.find((x) => x.kind === kind);
              const status: DocumentStatus = d?.status ?? 'missing';
              const expired = d ? isExpired(d) : false;
              return (
                <li key={kind} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-body text-sm font-semibold">{t(`doc.${kind}`)}</span>
                    <Pill tone={tone(status, expired)}>{expired ? t('supplier.onb.expired') : t(`doc.status.${status}`)}</Pill>
                  </div>
                  {d?.expires_on && (
                    <span className="font-body text-xs text-ink/60">{t('supplier.onb.expires_on', { date: d.expires_on })}</span>
                  )}
                  {d?.status === 'rejected' && d.notes && <span className="font-body text-xs text-chilli">{d.notes}</span>}
                  {d?.file_path && (
                    <Button variant="secondary" type="button" className="min-h-12" onClick={() => void viewDoc(d.file_path as string)}>
                      {t('supplier.onb.view_doc', { doc: t(`doc.${kind}`) })}
                    </Button>
                  )}
                  <input
                    aria-label={t('supplier.onb.expiry_for', { doc: t(`doc.${kind}`) })}
                    type="date"
                    value={expiry[kind] ?? ''}
                    onChange={(e) => setExpiry((x) => ({ ...x, [kind]: e.target.value }))}
                    className="min-h-12 rounded-lg border border-ink/15 bg-white px-3 text-sm"
                  />
                  <FileField
                    label={t('supplier.onb.upload')}
                    accept="image/*,application/pdf"
                    done={status === 'uploaded' || status === 'approved'}
                    onFile={(f) => void uploadDoc(kind, f)}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {missing > 0 && <p className="font-body text-sm text-ink/60">{t('supplier.onb.missing', { count: missing })}</p>}
        <Button className="min-h-14 text-lg" disabled={missing > 0} onClick={() => void submit()}>
          {t('supplier.onb.submit')}
        </Button>
        {submitted && <p role="status" className="font-body text-sm text-green-700">{t('supplier.onb.submitted')}</p>}
      </div>
    </DashboardShell>
  );
}
