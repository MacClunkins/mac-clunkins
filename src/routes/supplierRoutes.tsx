import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { OnboardingGuard } from './OnboardingGuard';
import SupplierJobs from '../pages/supplier/Jobs';
import SupplierJobDetail from '../pages/supplier/JobDetail';
import SupplierStock from '../pages/supplier/Stock';
import SupplierPrices from '../pages/supplier/Prices';
import SupplierRequirements from '../pages/supplier/Requirements';
import SupplierOnboarding from '../pages/supplier/Onboarding';
import SupplierHelp from '../pages/supplier/Help';
import SupplierNotifications from '../pages/supplier/Notifications';
import SupplierPayouts from '../pages/supplier/Payouts';

const guard = (el: JSX.Element) => <ProtectedRoute allow={['supplier']}>{el}</ProtectedRoute>;

/** Mount inside <Routes> in App.tsx as `{supplierRoutes}` (a fragment of <Route>s). */
export const supplierRoutes = (
  <>
    <Route path="/supplier/jobs" element={guard(<SupplierJobs />)} />
    <Route path="/supplier/jobs/:id" element={guard(<SupplierJobDetail />)} />
    <Route path="/supplier/stock" element={guard(<SupplierStock />)} />
    <Route path="/supplier/prices" element={guard(<SupplierPrices />)} />
    <Route path="/supplier/requirements" element={guard(<SupplierRequirements />)} />
    <Route path="/supplier/onboarding" element={<OnboardingGuard role="supplier"><SupplierOnboarding /></OnboardingGuard>} />
    <Route path="/supplier/payouts" element={guard(<SupplierPayouts />)} />
    <Route path="/supplier/help" element={guard(<SupplierHelp />)} />
    <Route path="/supplier/inbox" element={guard(<SupplierNotifications />)} />
  </>
);
