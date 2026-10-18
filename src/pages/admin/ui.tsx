import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormField';
import { PageSpinner } from '../../components/PageSpinner';
import { formatCents } from '../../lib/format';
import { t } from './i18n';
import type { ApiError } from './api';

export const NAV: { to: string; key: string; end?: boolean }[] = [
  { to: '/admin', key: 'dashboard', end: true },
  { to: '/admin/orders', key: 'orders' },
  { to: '/admin/quotes', key: 'quotes' },
  { to: '/admin/schedule', key: 'schedule' },
  { to: '/admin/users', key: 'users' },
  { to: '/admin/cases', key: 'cases' },
  { to: '/admin/payouts', key: 'payouts' },
  { to: '/admin/compliance', key: 'compliance' },
  { to: '/admin/reports', key: 'reports' },
  { to: '/admin/audit', key: 'audit' },
  { to: '/admin/settings', key: 'settings' },
];

export const card = 'rounded-2xl bg-white p-5 shadow-sm';
export const th = 'px-3 py-2 text-left font-body text-xs font-semibold uppercase tracking-wide text-ink/50';
export const td = 'px-3 py-2 font-body text-sm';
export const input =
  'rounded-lg border border-ink/15 bg-white px-3 py-1.5 font-body text-sm focus:border-chilli focus:outline-none focus:ring-2 focus:ring-chilli/30';

export function AdminLayout({ title, subtitle, actions, children }: {
  title: string; subtitle?: string; actions?: ReactNode; children: ReactNode;
}) {
  const { profile, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-cream text-ink">
      <header className="border-b border-ink/10 bg-white">
        <div className="flex items-center justify-between px-4 py-3 sm:px-8">
          <div>
            <span className="font-heading text-lg font-bold text-chilli">McCluckin&rsquo;s</span>
            <span className="ml-2 rounded-full bg-mustard/30 px-2.5 py-0.5 font-body text-xs font-semibold uppercase tracking-wide text-ink/70">
              {t('admin.role')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-body text-sm text-ink/70 sm:inline">{profile?.full_name ?? ''}</span>
            <Button variant="secondary" onClick={() => void signOut()}>{t('admin.logout')}</Button>
          </div>
        </div>
        <nav aria-label={t('admin.nav.label')} className="flex gap-1 overflow-x-auto px-4 sm:px-8">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap px-3 py-2 font-body text-sm font-semibold ${isActive ? 'border-b-2 border-chilli text-chilli' : 'text-ink/50 hover:text-ink'}`
              }
            >
              {t(`admin.nav.${n.key}`)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-8">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold">{title}</h1>
            {subtitle && <p className="mt-1 font-body text-sm text-ink/60">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}

export function LoadState({ loading, error, hasData = true, label, children }: {
  loading: boolean; error: ApiError | null; hasData?: boolean; label?: string; children: ReactNode;
}) {
  if (error) return <FormError message={t('admin.common.loadError', { message: error.message })} />;
  if (loading && !hasData) return <div className="relative h-40"><PageSpinner label={label ?? t('admin.common.loading')} /></div>;
  return <>{children}</>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-ink/10">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={`whitespace-nowrap px-3 py-2 font-body text-sm font-semibold ${value === tab.value ? 'border-b-2 border-chilli text-chilli' : 'text-ink/50 hover:text-ink'}`}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 rounded-full bg-ink/10 px-1.5 text-xs">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

const TONES: Record<string, string> = {
  good: 'bg-green-100 text-green-800',
  warn: 'bg-mustard/30 text-ink/80',
  bad: 'bg-chilli/10 text-chilli',
  neutral: 'bg-ink/10 text-ink/70',
};
export function Pill({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-body text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Money({ cents, strong }: { cents: number; strong?: boolean }) {
  return <span data-cents={cents} className={strong ? 'font-bold' : undefined}>{formatCents(cents)}</span>;
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/20 bg-white/60 px-6 py-10 text-center">
      <h2 className="font-heading text-base font-bold">{title}</h2>
      {body && <p className="mx-auto mt-1 max-w-md font-body text-sm text-ink/60">{body}</p>}
    </div>
  );
}

export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; className?: string }

export function DataTable<T>({ columns, rows, rowKey, onRowClick, selected, onToggle, onToggleAll, empty }: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void;
  selected?: Set<string>; onToggle?: (id: string) => void; onToggleAll?: () => void; empty?: ReactNode;
}) {
  if (!rows.length) return <>{empty ?? <Empty title={t('admin.common.none')} />}</>;
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="min-w-full divide-y divide-ink/10">
        <thead>
          <tr>
            {selected && (
              <th className={th}>
                <input type="checkbox" aria-label={t('admin.common.selectAll')} checked={rows.length > 0 && rows.every((r) => selected.has(rowKey(r)))} onChange={onToggleAll} />
              </th>
            )}
            {columns.map((c) => <th key={c.key} className={th}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {rows.map((r) => (
            <tr key={rowKey(r)} className={onRowClick ? 'cursor-pointer hover:bg-cream/60' : undefined} onClick={() => onRowClick?.(r)}>
              {selected && (
                <td className={td} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={t('admin.common.select')} checked={selected.has(rowKey(r))} onChange={() => onToggle?.(rowKey(r))} />
                </td>
              )}
              {columns.map((c) => <td key={c.key} className={`${td} ${c.className ?? ''}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Confirm step for destructive / financial actions. */
export function ConfirmDialog({ open, title, body, confirmLabel, destructive, busy, onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; destructive?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        <div className="mt-2 font-body text-sm text-ink/70">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{t('admin.common.cancel')}</Button>
          <Button onClick={onConfirm} disabled={busy} className={destructive ? 'bg-ink hover:bg-ink/90' : ''}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export interface PendingAction { title: string; body: ReactNode; confirmLabel: string; destructive?: boolean; run: () => Promise<unknown> | void }

/** Small state holder: ask(action) opens the confirm dialog, confirming runs it. */
export function useConfirm() {
  const [action, setAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = (
    <ConfirmDialog
      open={!!action}
      title={action?.title ?? ''}
      body={action?.body}
      confirmLabel={action?.confirmLabel ?? ''}
      destructive={action?.destructive}
      busy={busy}
      onCancel={() => setAction(null)}
      onConfirm={async () => {
        if (!action) return;
        setBusy(true);
        try { await action.run(); } finally { setBusy(false); setAction(null); }
      }}
    />
  );
  return { ask: setAction, dialog };
}

export function StatLine({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 font-body text-sm ${strong ? 'border-t border-ink/10 pt-2 font-bold' : ''}`}>
      <span className="text-ink/70">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 font-heading text-base font-bold">{children}</h2>;
}

export function errorText(e: ApiError | null | undefined): string | null {
  if (!e) return null;
  const key = e.code ? `admin.errors.${e.code}` : '';
  const translated = key ? t(key) : key;
  return translated && translated !== key ? translated : e.message;
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-ZA') : '-';
}
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' }) : '-';
}
export function displayName(n?: { full_name: string; business_name: string | null } | null): string {
  return n ? n.business_name ?? n.full_name : '-';
}
export function tStatus(group: string, value: string): string {
  return t(`admin.status.${group}.${value}`);
}
