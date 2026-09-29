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

function Guard({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <SignIn />} />
      <Route path="/d/*" element={<Guard role="dispatcher"><DispatcherApp /></Guard>} />
      <Route path="/l/*" element={<Guard role="loader"><LoaderApp /></Guard>} />
      <Route path="/r/*" element={<Guard role="driver"><DriverApp /></Guard>} />
      <Route path="/s/*" element={<Guard role="store_manager"><StoreApp /></Guard>} />
      <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}
