import { DashboardShell } from '../../components/DashboardShell';
import { HelpBody } from '../supplier-driver-shared/HelpBody';
import { t } from '../supplier-driver-shared/t';
import { SupplierNav } from './SupplierNav';

export default function SupplierHelp() {
  return (
    <DashboardShell roleLabel={t('supplier.role')}>
      <SupplierNav />
      <HelpBody role="supplier" />
    </DashboardShell>
  );
}
