import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import { loadAuditLog } from './api';
import { describeChange, humanizeAction, type AuditRow } from './logic/audit';
import { t } from './i18n';
import { AdminLayout, Empty, card, displayName, errorText, formatDateTime, input } from './ui';

const ENTITIES = ['orders', 'quotes', 'allocations', 'trips', 'payments', 'transfers', 'incidents', 'settings', 'areas_served', 'profiles', 'documents', 'cases', 'bank_statements'];
const PAGE = 100;

export function actionLabel(action: string): string {
  // action names contain dots (payment.manual), which the translation lookup would read as nesting
  const key = `admin.audit.action.${action.replace(/\./g, '_')}`;
  const label = t(key);
  return label === key ? humanizeAction(action) : label;
}

export default function AdminAuditLog() {
  const [entity, setEntity] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    const last = reset ? undefined : rows[rows.length - 1]?.created_at;
    const r = await loadAuditLog({ entity: entity || undefined, search, before: last, limit: PAGE });
    setLoading(false);
    setMsg(errorText(r.error));
    if (r.error) return;
    const next = r.data ?? [];
    setRows(reset ? next : [...rows, ...next]);
    setMore(next.length === PAGE);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(true); }, [entity]);

  return (
    <AdminLayout title={t('admin.audit.title')} subtitle={t('admin.audit.subtitle')}>
      <div className="mb-4 flex flex-wrap items-end gap-3 font-body text-sm">
        <label className="flex flex-col gap-1">{t('admin.audit.entity')}
          <select className={input} aria-label={t('admin.audit.entity')} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">{t('admin.common.all')}</option>
            {ENTITIES.map((e) => (<option key={e} value={e}>{t(`admin.audit.entities.${e}`)}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1">{t('admin.audit.search')}
          <input className={input} aria-label={t('admin.audit.search')} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(true); }} />
        </label>
        <Button variant="secondary" onClick={() => void load(true)}>{t('admin.audit.apply')}</Button>
      </div>
      <FormError message={msg} />
      {rows.length === 0 && !loading ? <Empty title={t('admin.audit.none')} /> : (
        <ul className="flex flex-col gap-2" data-testid="audit-rows">
          {rows.map((r) => (
            <li key={r.id} className={card}>
              <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left font-body text-sm" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <span className="text-xs text-ink/60">{formatDateTime(r.created_at)}</span>
                <span className="font-semibold">{actionLabel(r.action)}</span>
                <span className="text-ink/70">{r.actor ? displayName(r.actor) : t('admin.audit.system')}</span>
                <span className="text-ink/60">
                  {t(`admin.audit.entities.${r.entity}`) === `admin.audit.entities.${r.entity}` ? r.entity : t(`admin.audit.entities.${r.entity}`)}
                  {r.entity === 'orders' && r.entity_id ? <> · <Link className="font-semibold text-chilli underline" to={`/admin/orders/${r.entity_id}`} onClick={(e) => e.stopPropagation()}>{t('admin.audit.openOrder')}</Link></> : null}
                </span>
              </button>
              {openId === r.id && (
                <ul className="mt-3 list-disc pl-5 font-body text-sm text-ink/80" data-testid="audit-detail">
                  {describeChange(r.before, r.after).length === 0 ? <li>{t('admin.audit.noDetail')}</li> : describeChange(r.before, r.after).map((l) => (<li key={l}>{l}</li>))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {more && <div className="mt-4"><Button variant="secondary" disabled={loading} onClick={() => void load(false)}>{t('admin.audit.more')}</Button></div>}
    </AdminLayout>
  );
}
