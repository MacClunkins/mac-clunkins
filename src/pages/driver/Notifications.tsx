import { DashboardShell } from '../../components/DashboardShell';
import { InboxBody } from '../supplier-driver-shared/InboxBody';
import { t } from '../supplier-driver-shared/t';
import { DriverNav } from './DriverNav';

export default function DriverNotifications() {
  return (
    <DashboardShell roleLabel={t('driver.role')}>
      <DriverNav />
      <InboxBody role="driver" />
    </DashboardShell>
  );
}
