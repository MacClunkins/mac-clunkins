import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { Button } from '../../../components/Button';
import { useUnreadCount } from '../../supplier-driver-shared/InboxBody';
import { t } from '../i18n-shim';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 font-body text-sm font-semibold ${isActive ? 'bg-ink text-cream' : 'text-ink/70 hover:bg-ink/5'}`;

/** Buyer chrome. Own header (instead of DashboardShell) so order history can use the full desktop width. */
export function BuyerLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { profile, signOut } = useAuth();
  const unread = useUnreadCount();
  return (
    <div className="min-h-screen bg-cream font-body text-ink">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="font-heading text-lg font-bold text-chilli">{t('buyer.brand')}</span>
            <span className="rounded-full bg-mustard/30 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink/70">
              {t('buyer.roleLabel')}
            </span>
          </div>
          <nav aria-label={t('buyer.nav.label')} className="order-3 flex w-full gap-1 sm:order-2 sm:w-auto">
            <NavLink to="/orders" end className={navClass}>
              {t('buyer.nav.orders')}
            </NavLink>
            <NavLink to="/orders/new" end className={navClass}>
              {t('buyer.nav.newOrder')}
            </NavLink>
            <NavLink to="/inbox" className={navClass}>
              {t('buyer.nav.inbox')}{unread > 0 ? ` (${unread})` : ''}
            </NavLink>
            <NavLink to="/profile" className={navClass}>
              {t('buyer.nav.profile')}
            </NavLink>
          </nav>
          <div className="order-2 flex items-center gap-3 sm:order-3">
            <span className="hidden text-sm text-ink/70 md:inline">{profile?.full_name}</span>
            <Button variant="secondary" onClick={() => void signOut()}>
              {t('buyer.nav.logout')}
            </Button>
          </div>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 sm:px-8 sm:py-8 ${wide ? 'max-w-7xl' : 'max-w-2xl'}`}>{children}</main>
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-5">
      <h1 className="font-heading text-2xl font-bold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-ink/60">{sub}</p>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-white p-4 shadow-sm sm:p-5 ${className}`}>{children}</section>;
}
