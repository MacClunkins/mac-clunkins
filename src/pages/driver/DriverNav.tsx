import { SubNav } from '../supplier-driver-shared/ui';
import { t } from '../supplier-driver-shared/t';
import { useUnreadCount } from '../supplier-driver-shared/InboxBody';

export function DriverNav() {
  const unread = useUnreadCount();
  return (
    <SubNav
      items={[
        { to: '/driver/trips', label: t('driver.nav.trips') },
        { to: '/driver/earnings', label: t('driver.nav.earnings') },
        { to: '/driver/onboarding', label: t('driver.nav.onboarding') },
        { to: '/driver/help', label: t('driver.nav.help') },
        { to: '/driver/inbox', label: `${t('driver.nav.inbox')}${unread > 0 ? ` (${unread})` : ''}` },
      ]}
    />
  );
}
