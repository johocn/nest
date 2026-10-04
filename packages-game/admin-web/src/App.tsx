import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import GMCommand from './pages/GMCommand';
import Trace from './pages/Trace';
import Ladder from './pages/Ladder';
import RoomPage from './pages/Room';

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div style={{ padding: 24 }}>
      <h2>{title}</h2>
      <p>（页面占位，后续实现）</p>
    </div>
  );
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
        <Route path="config" element={<PlaceholderPage title="配置中心" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
