import type { ReactNode } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import AdminAuditLog from '../pages/admin/AuditLog';
import AdminCases from '../pages/admin/Cases';
import AdminCompliance from '../pages/admin/Compliance';
import AdminDashboard from '../pages/admin/Dashboard';
import AdminIncidents from '../pages/admin/Incidents';
import AdminOrderDetail from '../pages/admin/OrderDetail';
import AdminOrders from '../pages/admin/Orders';
import AdminPayouts from '../pages/admin/Payouts';
import AdminQuotes from '../pages/admin/Quotes';
import AdminReports from '../pages/admin/Reports';
import AdminSchedule from '../pages/admin/Schedule';
import AdminSettings from '../pages/admin/Settings';
import AdminUsers from '../pages/admin/Users';

const guard = (el: ReactNode) => <ProtectedRoute allow={['admin']}>{el}</ProtectedRoute>;

/**
 * Mount inside <Routes> in App.tsx:  {adminRoutes}
 * (a Fragment of <Route>s, which react-router v6 accepts). Remove the old /admin and
 * /admin/users routes from App.tsx when mounting - these replace them.
 */
export const adminRoutes = (
  <>
    <Route path="/admin" element={guard(<AdminDashboard />)} />
    <Route path="/admin/orders" element={guard(<AdminOrders />)} />
    <Route path="/admin/orders/:id" element={guard(<AdminOrderDetail />)} />
    <Route path="/admin/quotes" element={guard(<AdminQuotes />)} />
    <Route path="/admin/incidents" element={guard(<AdminIncidents />)} />
    <Route path="/admin/schedule" element={guard(<AdminSchedule />)} />
    <Route path="/admin/users" element={guard(<AdminUsers />)} />
    <Route path="/admin/cases" element={guard(<AdminCases />)} />
    <Route path="/admin/payouts" element={guard(<AdminPayouts />)} />
    <Route path="/admin/compliance" element={guard(<AdminCompliance />)} />
    <Route path="/admin/reports" element={guard(<AdminReports />)} />
    <Route path="/admin/audit" element={guard(<AdminAuditLog />)} />
    <Route path="/admin/settings" element={guard(<AdminSettings />)} />
  </>
);
