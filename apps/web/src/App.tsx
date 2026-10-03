import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HOME, useAuth } from './lib/auth';
import type { Role } from './lib/api';
import { Loading } from './components/common';
import SignIn from './pages/SignIn';

const DispatcherApp = lazy(() => import('./pages/dispatcher/DispatcherApp'));
const LoaderApp = lazy(() => import('./pages/loader/LoaderApp'));
const DriverApp = lazy(() => import('./pages/driver/DriverApp'));
const StoreApp = lazy(() => import('./pages/store/StoreApp'));
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));
const Account = lazy(() => import('./pages/Account'));

/** Route guard: signed in, the right role, and no pending password change. */
function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (user.mustChangePassword) return <Navigate to="/account?required=1" replace />;
  if (!roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <Suspense fallback={<Loading variant="page" />}>{children}</Suspense>;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user && !user.mustChangePassword ? <Navigate to={HOME[user.role]} replace /> : <SignIn />} />
      <Route path="/account" element={user ? <Suspense fallback={<Loading variant="page" />}><Account /></Suspense> : <Navigate to="/login" replace />} />
      <Route path="/a/*" element={<Guard roles={['admin']}><AdminApp /></Guard>} />
      <Route path="/d/*" element={<Guard roles={['dispatcher', 'admin']}><DispatcherApp /></Guard>} />
      <Route path="/l/*" element={<Guard roles={['loader']}><LoaderApp /></Guard>} />
      <Route path="/r/*" element={<Guard roles={['driver']}><DriverApp /></Guard>} />
      <Route path="/s/*" element={<Guard roles={['store_manager']}><StoreApp /></Guard>} />
      <Route path="*" element={<Navigate to={user ? (user.mustChangePassword ? '/account?required=1' : HOME[user.role]) : '/login'} replace />} />
    </Routes>
  );
}
