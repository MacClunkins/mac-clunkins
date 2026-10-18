import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import { formatCents } from '../../lib/format';
import { loadAreas, loadSettings, updateArea, updateSettings } from './api';
import { useAdminData } from './hooks/useAdminData';
import { SETTING_DEFS, changedKeys, validateSetting, type SettingDef } from './logic/settings';
import type { AreaRow, JsonValue, SettingsMap } from './types';
import { t } from './i18n';
import { AdminLayout, LoadState, Pill, SectionTitle, card, errorText, input, useConfirm } from './ui';

const LANGS = ['en', 'zu', 'st', 'tn'];

const COMPANY_FIELDS = [
  'name', 'address', 'email', 'phone', 'registration',
  'bank_name', 'account_holder', 'account_number', 'branch_code', 'account_type',
] as const;

type Company = Record<(typeof COMPANY_FIELDS)[number], string>;

/** Turns a template key such as `msg.order_paid` into "Order paid" so no database key is shown. */
function templateLabel(k: string): string {
  const words = k.replace(/^msg\./, '').replace(/[._]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : k;
}

function keyLabel(k: string): string {
  const id = `admin.settings.key.${k}`;
  const label = t(id);
  return label === id ? templateLabel(k) : label;
}

function readCompany(v: JsonValue | undefined): Company {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return Object.fromEntries(COMPANY_FIELDS.map((f) => [f, typeof o[f] === 'string' ? (o[f] as string) : ''])) as Company;
}

function show(v: JsonValue | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

export default function AdminSettings() {
  const { profile } = useAuth();
  const settings = useAdminData(loadSettings, []);
  const areas = useAdminData(loadAreas, []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState('manual');
  const [company, setCompany] = useState<Company>(readCompany(undefined));
  const { ask, dialog } = useConfirm();
  const current: SettingsMap = settings.data ?? {};

  useEffect(() => {
    if (settings.data) {
      setDraft(Object.fromEntries(SETTING_DEFS.map((d) => [d.key, show(settings.data?.[d.key])])));
      setMode(settings.data.payments_mode === 'paystack' ? 'paystack' : 'manual');
      setCompany(readCompany(settings.data.company_profile));
    }
  }, [settings.data]);

  async function persist(next: SettingsMap) {
    const r = await updateSettings(profile?.id ?? '', current, next);
    setMsg(errorText(r.error));
    setSaved(!r.error);
    if (!r.error) settings.reload();
  }

  function submitDefs() {
    const next: SettingsMap = {};
    const errs: Record<string, string> = {};
    for (const d of SETTING_DEFS) {
      const res = validateSetting(d, draft[d.key] ?? '');
      if (res.ok) next[d.key] = res.value; else errs[d.key] = t(`admin.settings.error.${res.error}`);
    }
    setErrors(errs);
    setSaved(false);
    if (Object.keys(errs).length) return;
    const keys = changedKeys(current, next);
    if (!keys.length) { setMsg(t('admin.settings.noChanges')); return; }
    setMsg(null);
    ask({
      title: t('admin.settings.confirmTitle'),
      body: (
        <div>
          <ul className="mb-2 list-disc pl-5">
            {keys.map((k) => <li key={k}>{keyLabel(k)}: {show(current[k]) || t('admin.settings.notSet')} &rarr; {show(next[k]) || t('admin.settings.notSet')}</li>)}
          </ul>
          <p className="font-semibold">{t('admin.settings.newQuotesOnly')}</p>
        </div>
      ),
      confirmLabel: t('admin.settings.save'),
      run: () => persist(next),
    });
  }

  const companyDirty = JSON.stringify(company) !== JSON.stringify(readCompany(current.company_profile));
  const modeDirty = mode !== (current.payments_mode === 'paystack' ? 'paystack' : 'manual');

  function submitPayments() {
    const next: SettingsMap = {};
    if (modeDirty) next.payments_mode = mode;
    if (companyDirty) next.company_profile = company;
    setSaved(false);
    setMsg(null);
    ask({
      title: t('admin.settings.confirmTitle'),
      body: (
        <ul className="list-disc pl-5">
          {modeDirty && <li>{t('admin.settings.paymentsMode')}: {t(`admin.settings.mode_${mode}`)}</li>}
          {companyDirty && <li>{t('admin.settings.company')}</li>}
        </ul>
      ),
      confirmLabel: t('admin.settings.save'),
      run: () => persist(next),
    });
  }

  const group = (g: SettingDef['group']) => SETTING_DEFS.filter((d) => d.group === g);
  const templateKeys = Object.keys(current).filter((k) => k.startsWith('msg.')).sort();
  const enabledLangs = Array.isArray(current.languages_enabled) ? (current.languages_enabled as string[]) : LANGS;

  const field = (d: SettingDef) => (
    <label key={d.key} className="flex flex-col gap-1 font-body text-sm">
      <span className="font-medium">{t(`admin.settings.key.${d.key}`)}</span>
      <span className="flex items-center gap-2">
        <input className={`${input} w-40`} inputMode="decimal" aria-label={t(`admin.settings.key.${d.key}`)} value={draft[d.key] ?? ''} onChange={(e) => setDraft({ ...draft, [d.key]: e.target.value })} />
        <span className="text-ink/50">
          {d.kind === 'percent' ? '%' : d.kind === 'cents' ? `${t('admin.settings.cents')} (${/^\d+$/.test(draft[d.key] ?? '') ? formatCents(Number(draft[d.key])) : '-'})` : ''}
        </span>
      </span>
      {errors[d.key] && <span role="alert" className="text-xs text-chilli">{errors[d.key]}</span>}
    </label>
  );

  return (
    <AdminLayout title={t('admin.settings.title')} subtitle={t('admin.settings.subtitle')}>
      <p className="mb-4 rounded-xl bg-mustard/25 px-4 py-2 font-body text-sm">{t('admin.settings.newQuotesOnly')}</p>
      <FormError message={msg} />
      {saved && <p role="status" className="mb-3 rounded-lg bg-green-100 px-3 py-2 font-body text-sm text-green-800">{t('admin.settings.saved')}</p>}
      <LoadState loading={settings.loading} error={settings.error} hasData={!!settings.data}>
        <div className="flex flex-col gap-6">
          {(['pricing', 'limits', 'timeline'] as const).map((g) => (
            <section key={g} className={card}>
              <SectionTitle>{t(`admin.settings.group.${g}`)}</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{group(g).map(field)}</div>
              {g === 'timeline' && <p className="mt-2 font-body text-xs text-ink/50">{t('admin.settings.timelineHelp')}</p>}
            </section>
          ))}
          <div><Button onClick={submitDefs}>{t('admin.settings.saveAll')}</Button></div>

          <section className={card}>
            <SectionTitle>{t('admin.settings.payments')}</SectionTitle>
            <label className="mb-4 flex flex-col gap-1 font-body text-sm">
              <span className="font-medium">{t('admin.settings.paymentsMode')}</span>
              <select className={`${input} w-72`} aria-label={t('admin.settings.paymentsMode')} value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="manual">{t('admin.settings.mode_manual')}</option>
                <option value="paystack">{t('admin.settings.mode_paystack')}</option>
              </select>
              <span className="text-xs text-ink/50">{t('admin.settings.paymentsModeHelp')}</span>
            </label>
            <SectionTitle>{t('admin.settings.company')}</SectionTitle>
            <p className="mb-3 font-body text-xs text-ink/50">{t('admin.settings.companyHelp')}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {COMPANY_FIELDS.map((f) => (
                <label key={f} className="flex flex-col gap-1 font-body text-sm">
                  <span className="font-medium">{t(`admin.settings.company_${f}`)}</span>
                  <input className={input} aria-label={t(`admin.settings.company_${f}`)} value={company[f]} onChange={(e) => setCompany({ ...company, [f]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="mt-4"><Button disabled={!companyDirty && !modeDirty} onClick={submitPayments}>{t('admin.settings.savePayments')}</Button></div>
          </section>

          <section className={card}>
            <SectionTitle>{t('admin.settings.integrations')}</SectionTitle>
            <div className="flex flex-wrap gap-6 font-body text-sm">
              <p>{t('admin.settings.paystack')}: <Pill tone={current.paystack_mode === 'test' ? 'warn' : current.paystack_mode === 'live' ? 'good' : 'neutral'}>{current.paystack_mode === 'test' ? t('admin.settings.modeTest') : current.paystack_mode === 'live' ? t('admin.settings.modeLive') : t('admin.settings.unknown')}</Pill></p>
              <p>{t('admin.settings.email')}: <Pill tone={current.email_mode === 'sandbox' ? 'warn' : current.email_mode === 'live' ? 'good' : 'neutral'}>{current.email_mode === 'sandbox' ? t('admin.settings.emailSandbox') : current.email_mode === 'live' ? t('admin.settings.modeLive') : t('admin.settings.unknown')}</Pill></p>
            </div>
            <p className="mt-2 font-body text-xs text-ink/50">{t('admin.settings.noSecrets')}</p>
          </section>

          <section className={card}>
            <SectionTitle>{t('admin.settings.provinces')}</SectionTitle>
            <LoadState loading={areas.loading} error={areas.error} hasData={!!areas.data}>
              <ul className="flex flex-col gap-2">
                {(areas.data ?? []).map((a) => (
                  <AreaEditor key={a.province} area={a} onSave={(after) => ask({
                    title: t('admin.settings.confirmTitle'),
                    body: t('admin.settings.areaBody', { name: a.name ?? a.province }),
                    confirmLabel: t('admin.settings.save'),
                    run: async () => {
                      const r = await updateArea(profile?.id ?? '', a, after);
                      setMsg(errorText(r.error));
                      if (!r.error) areas.reload();
                    },
                  })} />
                ))}
              </ul>
            </LoadState>
          </section>

          <section className={card}>
            <SectionTitle>{t('admin.settings.languages')}</SectionTitle>
            <div className="flex flex-wrap gap-4 font-body text-sm">
              {LANGS.map((l) => (
                <label key={l} className="flex items-center gap-2">
                  <input type="checkbox" checked={enabledLangs.includes(l)} disabled={l === 'en'} onChange={(e) => ask({
                    title: t('admin.settings.confirmTitle'), body: t('admin.settings.langBody', { lang: t(`admin.lang.${l}`) }), confirmLabel: t('admin.settings.save'),
                    run: () => persist({ languages_enabled: e.target.checked ? [...enabledLangs, l] : enabledLangs.filter((x) => x !== l) }),
                  })} />
                  {t(`admin.lang.${l}`)}
                </label>
              ))}
            </div>
          </section>

          <section className={card}>
            <SectionTitle>{t('admin.settings.templates')}</SectionTitle>
            {templateKeys.length === 0 ? <p className="font-body text-sm text-ink/60">{t('admin.settings.templatesNone')}</p> : (
              <ul className="flex flex-col gap-4">
                {templateKeys.map((k) => <TemplateEditor key={k} k={k} value={show(current[k])} onSave={(v) => ask({ title: t('admin.settings.confirmTitle'), body: templateLabel(k), confirmLabel: t('admin.settings.save'), run: () => persist({ [k]: v }) })} />)}
              </ul>
            )}
          </section>
        </div>
      </LoadState>
      {dialog}
    </AdminLayout>
  );
}

function AreaEditor({ area, onSave }: { area: AreaRow; onSave: (after: Pick<AreaRow, 'active' | 'launch_order'>) => void }) {
  const [active, setActive] = useState(area.active);
  const [order, setOrder] = useState(area.launch_order === null ? '' : String(area.launch_order));
  const dirty = active !== area.active || order !== (area.launch_order === null ? '' : String(area.launch_order));
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-xl bg-cream px-3 py-2 font-body text-sm">
      <span className="w-40 font-semibold">{area.name}</span>
      <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('admin.settings.areaActive')}</label>
      <label className="flex items-center gap-2">{t('admin.settings.launchOrder')}<input className={`${input} w-20`} inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} /></label>
      <Button variant="secondary" disabled={!dirty} onClick={() => onSave({ active, launch_order: order.trim() === '' ? null : Number(order) })}>{t('admin.settings.save')}</Button>
    </li>
  );
}

function TemplateEditor({ k, value, onSave }: { k: string; value: string; onSave: (v: string) => void }) {
  const label = templateLabel(k);
  const [text, setText] = useState(value);
  return (
    <li className="flex flex-col gap-1 font-body text-sm">
      <span className="font-medium">{label}</span>
      <textarea className={input} rows={3} aria-label={label} value={text} onChange={(e) => setText(e.target.value)} />
      <div><Button variant="secondary" disabled={text === value || !text.trim()} onClick={() => onSave(text.trim())}>{t('admin.settings.save')}</Button></div>
    </li>
  );
}
