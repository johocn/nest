import { Layout, Menu, Button } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  ThunderboltOutlined,
  GlobalOutlined as GlobeOutlined,
  TeamOutlined,
  LineChartOutlined,
  UserOutlined,
  SafetyOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';

const { Header, Sider, Content } = Layout;

type MenuItem = Required<MenuProps>['items'][number];

const menuItems: MenuItem[] = [
  {
    key: 'ops',
    icon: <ThunderboltOutlined />,
    label: '运维',
    children: [
      { key: '/gm', label: 'GM命令' },
      { key: '/trace', label: '可观测性' },
      { key: '/ladder', label: '天梯' },
      { key: '/room', label: 'Room' },
      { key: '/config', label: '配置中心' },
      { key: '/player', label: '玩家管理', icon: <UserOutlined /> },
      { key: '/risk', label: '风控', icon: <SafetyOutlined /> },
    ],
  },
  {
    key: 'world',
    icon: <GlobeOutlined />,
    label: '世界运营',
    children: [
      { key: '/world/scene', label: '场景管理' },
      { key: '/world/npc', label: 'NPC管理' },
      { key: '/world/building', label: '建筑蓝图' },
    ],
  },
  {
    key: 'community',
    icon: <TeamOutlined />,
    label: '社区运营',
    children: [
      { key: '/community/feedback', label: '玩家反馈' },
      { key: '/community/reports', label: '举报处理' },
    ],
  },
  {
    key: 'analytics',
    icon: <LineChartOutlined />,
    label: '数据分析',
    children: [
      { key: '/analytics/dashboard', label: '运营看板' },
      { key: '/balance/audit', label: '经济审计' },
    ],
  },
  {
    key: 'gameconfig',
    icon: <SettingOutlined />,
    label: '游戏配置',
    children: [
      { key: '/realm', label: '境界模板' },
      { key: '/inventory', label: '物品模板' },
    ],
  },
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
      <Sider theme="light" width={220}>
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
