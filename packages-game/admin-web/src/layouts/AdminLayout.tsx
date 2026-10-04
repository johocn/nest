import { Layout, Menu, Button } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  ThunderboltOutlined,
  SearchOutlined,
  TrophyOutlined,
  TeamOutlined,
  SettingOutlined,
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/gm', icon: <ThunderboltOutlined />, label: 'GM命令' },
  { key: '/trace', icon: <SearchOutlined />, label: '可观测性' },
  { key: '/ladder', icon: <TrophyOutlined />, label: '天梯' },
  { key: '/room', icon: <TeamOutlined />, label: 'Room' },
  { key: '/config', icon: <SettingOutlined />, label: '配置中心' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    navigate('/login', { replace: true });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light">
        <div style={{ height: 48, lineHeight: '48px', textAlign: 'center', fontWeight: 'bold' }}>
          Game Admin
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <Button onClick={handleLogout}>登出</Button>
        </Header>
        <Content style={{ margin: 16, background: '#f5f5f5', minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
