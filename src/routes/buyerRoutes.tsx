import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import BuyerNotifications from '../pages/buyer/Notifications';
import type { ReactElement } from 'react';
import BuyerOrders from '../pages/buyer/Orders';
import NewOrder from '../pages/buyer/NewOrder';
import ReviewPay from '../pages/buyer/ReviewPay';
import PaymentPaid from '../pages/buyer/PaymentPaid';
import PaymentFailed from '../pages/buyer/PaymentFailed';
import QuoteReady from '../pages/buyer/QuoteReady';
import OrderDetail from '../pages/buyer/OrderDetail';
import Track from '../pages/buyer/Track';
import Delivered from '../pages/buyer/Delivered';
import ReportProblem from '../pages/buyer/ReportProblem';
import CaseDetail from '../pages/buyer/CaseDetail';
import Profile from '../pages/buyer/Profile';

const guard = (el: ReactElement) => <ProtectedRoute allow={['buyer']}>{el}</ProtectedRoute>;

/**
 * Mount inside <Routes> in App.tsx as a plain expression (React Router v6 accepts a fragment of <Route>s):
 *   <Routes> ... {buyerRoutes} ... </Routes>
 * and delete App.tsx's existing /orders route + the BuyerOrders import.
 * Static segments (/orders/new, /orders/new/pay) outrank /orders/:id automatically in RR v6.
 */
export const buyerRoutes = (
  <>
    <Route path="/orders" element={guard(<BuyerOrders />)} />
    <Route path="/orders/new" element={guard(<NewOrder />)} />
    <Route path="/orders/new/pay" element={guard(<ReviewPay />)} />
    <Route path="/orders/:id" element={guard(<OrderDetail />)} />
    <Route path="/orders/:id/paid" element={guard(<PaymentPaid />)} />
    <Route path="/orders/:id/payment-failed" element={guard(<PaymentFailed />)} />
    <Route path="/orders/:id/track" element={guard(<Track />)} />
    <Route path="/orders/:id/delivered" element={guard(<Delivered />)} />
    <Route path="/orders/:id/problem" element={guard(<ReportProblem />)} />
    <Route path="/quotes/:id" element={guard(<QuoteReady />)} />
    <Route path="/cases/:id" element={guard(<CaseDetail />)} />
    <Route path="/inbox" element={guard(<BuyerNotifications />)} />
    <Route path="/profile" element={guard(<Profile />)} />
  </>
);
