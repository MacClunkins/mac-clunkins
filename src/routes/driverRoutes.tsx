import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { OnboardingGuard } from './OnboardingGuard';
import DriverTrips from '../pages/driver/Trips';
import DriverPickup from '../pages/driver/Pickup';
import DriverDone from '../pages/driver/Done';
import DriverHelp from '../pages/driver/Help';
import DriverEarnings from '../pages/driver/Earnings';
import DriverOnboarding from '../pages/driver/Onboarding';

const guard = (el: JSX.Element) => <ProtectedRoute allow={['driver']}>{el}</ProtectedRoute>;

/** Mount inside <Routes> in App.tsx as `{driverRoutes}` (a fragment of <Route>s). */
export const driverRoutes = (
  <>
    <Route path="/driver/trips" element={guard(<DriverTrips />)} />
    <Route path="/driver/trips/:id/pickup" element={guard(<DriverPickup />)} />
    <Route path="/driver/trips/:id/done" element={guard(<DriverDone />)} />
    <Route path="/driver/earnings" element={guard(<DriverEarnings />)} />
    <Route path="/driver/help" element={guard(<DriverHelp />)} />
    <Route path="/driver/onboarding" element={<OnboardingGuard role="driver"><DriverOnboarding /></OnboardingGuard>} />
  </>
);
