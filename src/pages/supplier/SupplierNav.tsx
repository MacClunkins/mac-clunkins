import { SubNav } from '../supplier-driver-shared/ui';
import { t } from '../supplier-driver-shared/t';
import { useUnreadCount } from '../supplier-driver-shared/InboxBody';

export function SupplierNav() {
  const unread = useUnreadCount();
  return (
    <SubNav
      items={[
        { to: '/supplier/jobs', label: t('supplier.nav.jobs') },
        { to: '/supplier/stock', label: t('supplier.nav.stock') },
        { to: '/supplier/prices', label: t('supplier.nav.prices') },
        { to: '/supplier/requirements', label: t('supplier.nav.requirements') },
        { to: '/supplier/onboarding', label: t('supplier.nav.onboarding') },
        { to: '/supplier/payouts', label: t('supplier.nav.payouts') },
        { to: '/supplier/help', label: t('supplier.nav.help') },
        { to: '/supplier/inbox', label: `${t('supplier.nav.inbox')}${unread > 0 ? ` (${unread})` : ''}` },
      ]}
    />
  );
}
