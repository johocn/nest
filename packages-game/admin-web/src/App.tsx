import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import GMCommand from './pages/GMCommand';
import Trace from './pages/Trace';
import Ladder from './pages/Ladder';
import RoomPage from './pages/Room';
import ConfigCenter from './pages/Config';
import ScenePage from './pages/World/Scene';
import NpcPage from './pages/World/Npc';
import BuildingPage from './pages/World/Building';
import FeedbackPage from './pages/Community/Feedback';
import ReportsPage from './pages/Community/Reports';
import DashboardPage from './pages/Analytics/Dashboard';
import BalanceAuditPage from './pages/Balance/Audit';
import PlayerPage from './pages/Player';
import RiskPage from './pages/Risk';
import RealmPage from './pages/Realm';
import InventoryPage from './pages/Inventory';

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/gm" replace />} />
        <Route path="gm" element={<GMCommand />} />
        <Route path="trace" element={<Trace />} />
        <Route path="ladder" element={<Ladder />} />
        <Route path="room" element={<RoomPage />} />
        <Route path="config" element={<ConfigCenter />} />

        <Route path="world/scene" element={<ScenePage />} />
        <Route path="world/npc" element={<NpcPage />} />
        <Route path="world/building" element={<BuildingPage />} />
        <Route path="community/feedback" element={<FeedbackPage />} />
        <Route path="community/reports" element={<ReportsPage />} />
        <Route path="analytics/dashboard" element={<DashboardPage />} />
        <Route path="balance/audit" element={<BalanceAuditPage />} />
        <Route path="player" element={<PlayerPage />} />
        <Route path="risk" element={<RiskPage />} />
        <Route path="realm" element={<RealmPage />} />
        <Route path="inventory" element={<InventoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
