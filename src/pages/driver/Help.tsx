import { DashboardShell } from '../../components/DashboardShell';
import { HelpBody } from '../supplier-driver-shared/HelpBody';
import { t } from '../supplier-driver-shared/t';
import { DriverNav } from './DriverNav';

export default function DriverHelp() {
  return (
    <DashboardShell roleLabel={t('driver.role')}>
      <DriverNav />
      <HelpBody role="driver" />
    </DashboardShell>
  );
}
