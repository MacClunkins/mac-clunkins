import { DashboardShell } from '../../components/DashboardShell';
import { InboxBody } from '../supplier-driver-shared/InboxBody';
import { t } from '../supplier-driver-shared/t';
import { SupplierNav } from './SupplierNav';

export default function SupplierNotifications() {
  return (
    <DashboardShell roleLabel={t('supplier.role')}>
      <SupplierNav />
      <InboxBody role="supplier" />
    </DashboardShell>
  );
}
