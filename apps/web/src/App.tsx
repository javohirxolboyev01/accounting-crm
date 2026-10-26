import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui/states';
import { useAuth } from './lib/auth';
import type { Role } from './lib/types';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const MyDay = lazy(() => import('./pages/MyDay'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientCard = lazy(() => import('./pages/ClientCard'));
const Monthly = lazy(() => import('./pages/Monthly'));
const Settings = lazy(() => import('./pages/Settings'));
const Users = lazy(() => import('./pages/Users'));
const Profile = lazy(() => import('./pages/Profile'));
const Audit = lazy(() => import('./pages/Audit'));
const Sheets = lazy(() => import('./pages/Sheets'));

/** UI darajasidagi himoya (qulaylik uchun). Haqiqiy ruxsat tekshiruvi serverda. */
function Protected({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading className="h-screen" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/my-day" replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'LEADER' ? '/dashboard' : '/my-day'} replace />;
}

const L: Role[] = ['LEADER'];

export default function App() {
  return (
    <Suspense fallback={<Loading className="h-screen" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<Protected roles={L}><Dashboard /></Protected>} />
          <Route path="my-day" element={<MyDay />} />
          <Route path="clients" element={<Clients />} />
          <Route path="clients/new" element={<Navigate to="/clients" replace />} />
          <Route path="clients/:id" element={<ClientCard />} />
          <Route path="monthly" element={<Monthly />} />
          <Route path="settings" element={<Protected roles={L}><Settings /></Protected>} />
          <Route path="users" element={<Protected roles={L}><Users /></Protected>} />
          <Route path="audit" element={<Protected roles={L}><Audit /></Protected>} />
          <Route path="sheets" element={<Protected roles={L}><Sheets /></Protected>} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
