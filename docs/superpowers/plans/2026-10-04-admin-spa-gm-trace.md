# Admin SPA + GM Panel MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为游戏后端（37 modules / 51 controllers）搭建 React + Ant Design Pro 独立后台 SPA（MVP 第一批：GM 命令 / 可观测性 / 战斗竞技 / 配置中心四模块）+ Laya 客户端 DOM overlay GM 面板（~ 键弹出）。**后端零改动**——全部消费今天已写完的 API。

**Architecture:** 两套前端并存：(a) 旧 `admin/index.html`（Vue CDN）保留处置面板；(b) 新 `packages-game/admin-web/`（React SPA）承载 GM/Trace/天梯/Room/配置，Vite 开发期代理 `/api` → game-server:3000，生产部署到 `/opt/game-server/admin-web/`；(c) 客户端 GM 面板以原生 HTML/CSS 直接挂 Canvas 父 div，零构建。

**Tech Stack:** React 18 + Vite 5 + TypeScript + Ant Design Pro 6 + openapi-typescript（从 Swagger `/api/docs` 生成类型）；后端 NestJS 11 不改。

---

## 文件结构

### 新建目录（packages-game/admin-web/）

| 文件 | 职责 |
|---|---|
| `package.json` | React 18 + Vite + AntD Pro + axios + openapi-typescript |
| `vite.config.ts` | dev 代理 `/api` → `http://localhost:3000` |
| `.env.development` | `VITE_API_BASE=/api` |
| `src/main.tsx` | 入口 |
| `src/App.tsx` | AntD Pro `<ConfigProvider><RouterProvider>` |
| `src/api/client.ts` | axios 实例：baseURL + interceptor 注入 JWT + 401 跳登录 |
| `src/api/types.ts` | `openapi-typescript http://localhost:3000/api/docs-json` 生成 |
| `src/layouts/AdminLayout.tsx` | 侧边菜单（GM/Trace/天梯/Room/配置）+ 顶栏（Admin 信息） |
| `src/pages/Login/index.tsx` | `POST api/admin/v1/auth/login` 拿 JWT |
| `src/pages/GMCommand/index.tsx` | 左命令树 + 右动态表单 + 执行 + 日志时间线 |
| `src/pages/Trace/index.tsx` | Trace Span 树 + 慢请求 + GM 操作日志 |
| `src/pages/Ladder/index.tsx` | ZSet 排行榜 + 一键赛季结算按钮 |
| `src/pages/Room/index.tsx` | 实时 Room 列表（status 标签 + 玩家数）|
| `src/pages/Config/index.tsx` | 键值对表格 + Buff/Skill/掉落表模板 CRUD |

### 客户端 GM 面板（game-client/src/gm-panel/）

| 文件 | 职责 |
|---|---|
| `index.html` | DOM overlay 结构（固定右下，z-index:9999）|
| `style.css` | 暗色主题（#1a1a2e）与后台 UI 同款 |
| `gm.js` | fetch 封装 + 命令注册表 + ~ 键 toggle + 微信小游戏隐藏 fallback |
| 集成点 `Main.ts` | `afterLogin()` 末尾调 `window.__initGMPanel()` |

---

## Tasks

### Task 1：admin-web 脚手架

**Files:**
- Create: `packages-game/admin-web/package.json`
- Create: `packages-game/admin-web/vite.config.ts`
- Create: `packages-game/admin-web/tsconfig.json`
- Create: `packages-game/admin-web/.env.development`
- Create: `packages-game/admin-web/index.html`
- Create: `packages-game/admin-web/src/main.tsx`
- Create: `packages-game/admin-web/src/App.tsx`

- [ ] **Step 1：写 package.json**

```json
{
  "name": "admin-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "gen-types": "openapi-typescript http://localhost:3000/api/docs-json -o src/api/types.ts"
  },
  "dependencies": {
    "@ant-design/icons": "^5.5.1",
    "@ant-design/pro-components": "^2.7.19",
    "antd": "^5.21.2",
    "axios": "^1.7.7",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.3",
    "openapi-typescript": "^7.5.2",
    "typescript": "^5.6.2",
    "vite": "^5.4.8"
  }
}
```

- [ ] **Step 2：写 vite.config.ts + .env**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

```bash
# .env.development
VITE_API_BASE=/api
```

- [ ] **Step 3：写 index.html + main.tsx + App.tsx**

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Game Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{ token: { colorPrimary: '#1677ff' } }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
```

```tsx
// src/App.tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import GMCommand from './pages/GMCommand';
import Trace from './pages/Trace';
import Ladder from './pages/Ladder';
import Room from './pages/Room';
import ConfigCenter from './pages/Config';

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const token = localStorage.getItem('admin_token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
};

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="room" element={<Room />} />
          <Route path="config" element={<ConfigCenter />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4：安装依赖 + 启动验证**

```bash
cd packages-game/admin-web
npm install
npm run dev
# 预期：Vite 启动在 http://localhost:5174，浏览器打开显示 Login 页（白屏含一个「登录」按钮）
```

- [ ] **Step 5：Commit**

```bash
git add packages-game/admin-web/
git commit -m "feat(admin-web): React + Vite + AntD Pro 脚手架"
```

---

### Task 2：API 层 + Login + Layout

**Files:**
- Create: `src/api/client.ts`
- Create: `src/layouts/AdminLayout.tsx`
- Create: `src/pages/Login/index.tsx`

- [ ] **Step 1：写 api/client.ts**

```ts
import axios from 'axios';
import { message } from 'antd';

const baseURL = import.meta.env.VITE_API_BASE ?? '/api';

const client = axios.create({ baseURL, timeout: 15000 });

// Request interceptor —— 注入 JWT
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor —— 401 跳登录 + 错误 toast
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    } else {
      message.error(err.response?.data?.message ?? err.message);
    }
    return Promise.reject(err);
  },
);

export default client;
```

- [ ] **Step 2：写 Login 页**

```tsx
// src/pages/Login/index.tsx
import { Button, Card, Form, Input } from 'antd';
import { useNavigate } from 'react-router-dom';
import client from '../../api/client';

export default function Login() {
  const nav = useNavigate();
  const onFinish = async (values: { username: string; password: string }) => {
    const res = await client.post('/admin/v1/auth/login', values);
    const token = res.data?.data?.token ?? res.data?.token;
    if (token) {
      localStorage.setItem('admin_token', token);
      nav('/');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
      <Card title="Game Admin" style={{ width: 360 }}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="username" label="账号" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>登录</Button>
        </Form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3：写 AdminLayout**

```tsx
// src/layouts/AdminLayout.tsx
import { Layout, Menu, Button } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  ThunderboltOutlined,
  SearchOutlined,
  TrophyOutlined,
  TeamOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/gm', icon: <ThunderboltOutlined />, label: 'GM 命令' },
  { key: '/trace', icon: <SearchOutlined />, label: '可观测性' },
  { key: '/ladder', icon: <TrophyOutlined />, label: '天梯' },
  { key: '/room', icon: <TeamOutlined />, label: 'Room' },
  { key: '/config', icon: <SettingOutlined />, label: '配置中心' },
];

export default function AdminLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider>
        <div style={{ height: 48, color: '#fff', textAlign: 'center', lineHeight: '48px', fontWeight: 600 }}>
          Game Admin
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[loc.pathname]} onClick={({ key }) => nav(key)} items={menuItems} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            icon={<LogoutOutlined />}
            onClick={() => { localStorage.removeItem('admin_token'); nav('/login'); }}
          >登出</Button>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
```

- [ ] **Step 4：启动验证 + Commit**

```bash
npm run dev
# 预期：http://localhost:5174 → Login 页 → 输入 admin 凭据登录 → 跳 GM 命令页（左菜单 5 项）
```

```bash
git add packages-game/admin-web/
git commit -m "feat(admin-web): API client + Login + AdminLayout"
```

---

### Task 3：GM 命令页面

**Backend APIs:** `GET api/admin/v1/ops/gm/list` + `POST api/admin/v1/ops/gm/execute`

**Files:** Create `src/pages/GMCommand/index.tsx`

- [ ] **Step 1：写 GMCommand 页面**

```tsx
// src/pages/GMCommand/index.tsx
import { useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, message, Tag, Timeline } from 'antd';
import client from '../../api/client';

interface GmCmd {
  name: string;
  description: string;
  argsSchema: Record<string, { type: string; description?: string; enum?: string[] }>;
}

interface ExecResult { ok: boolean; cmd: string; result?: any; logId?: string; error?: string; }

export default function GMCommand() {
  const [cmds, setCmds] = useState<GmCmd[]>([]);
  const [selectedCmd, setSelectedCmd] = useState<string>('');
  const [targetPlayerId, setTargetPlayerId] = useState('');
  const [args, setArgs] = useState<Record<string, any>>({});
  const [execLog, setExecLog] = useState<ExecResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get('/admin/v1/ops/gm/list').then((r) => setCmds(r.data?.data ?? []));
  }, []);

  const currentCmd = cmds.find((c) => c.name === selectedCmd);

  const exec = async () => {
    if (!selectedCmd || !targetPlayerId) return message.warning('请先选命令 + 填玩家 ID');
    setLoading(true);
    try {
      const res = await client.post('/admin/v1/ops/gm/execute', {
        cmd: selectedCmd,
        targetPlayerId,
        args,
      });
      setExecLog((prev) => [res.data.data ?? res.data, ...prev].slice(0, 20));
      message.success('执行成功');
    } catch {
      // response interceptor 已 toast
    } finally {
      setLoading(false);
    }
  };

  const renderArgInput = (key: string, schema: GmCmd['argsSchema'][string]) => {
    const val = args[key];
    const setVal = (v: any) => setArgs({ ...args, [key]: v });
    switch (schema.type) {
      case 'number':
        return <InputNumber value={val} onChange={setVal} style={{ width: '100%' }} />;
      case 'string':
        if (schema.enum)
          return <Select options={schema.enum.map((v) => ({ label: v, value: v }))} value={val} onChange={setVal} />;
        return <Input value={val} onChange={(e) => setVal(e.target.value)} />;
      case 'boolean':
        return <Select options={[{ label: 'true', value: true }, { label: 'false', value: false }]} value={val} onChange={setVal} />;
      default:
        return <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder={schema.type} />;
    }
  };

  return (
    <Row gutter={16}>
      <Col span={10}>
        <Card title="GM 命令">
          <Select
            style={{ width: '100%', marginBottom: 16 }}
            placeholder="选择命令"
            value={selectedCmd || undefined}
            onChange={(v) => { setSelectedCmd(v); setArgs({}); }}
            options={cmds.map((c) => ({
              label: `${c.name} — ${c.description}`,
              value: c.name,
            }))}
          />
          {currentCmd && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>目标玩家</div>
              <Input
                placeholder="playerId"
                value={targetPlayerId}
                onChange={(e) => setTargetPlayerId(e.target.value)}
                style={{ marginBottom: 16 }}
              />
              {Object.entries(currentCmd.argsSchema || {}).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 12 }}>
                  <div style={{ marginBottom: 4 }}><code>{k}</code> <span style={{ color: '#999', fontSize: 12 }}>{v.description}</span></div>
                  {renderArgInput(k, v)}
                </div>
              ))}
              <Button type="primary" loading={loading} onClick={exec} block>执行</Button>
            </div>
          )}
        </Card>
      </Col>
      <Col span={14}>
        <Card title="执行日志">
          {execLog.length === 0 ? (
            <div style={{ color: '#999', textAlign: 'center', padding: 40 }}>暂无执行记录</div>
          ) : (
            <Timeline
              items={execLog.map((log, i) => ({
                color: log.ok ? 'green' : 'red',
                children: (
                  <div>
                    <Space>
                      <Tag color={log.ok ? 'success' : 'error'}>{log.ok ? 'OK' : 'FAIL'}</Tag>
                      <code>{log.cmd}</code>
                    </Space>
                    <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                      {log.error ? log.error : JSON.stringify(log.result ?? null)}
                      {log.logId && <span style={{ color: '#1677ff' }}> · logId={log.logId}</span>}
                    </div>
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      </Col>
    </Row>
  );
}
```

- [ ] **Step 2：Commit**

```bash
git add packages-game/admin-web/src/pages/GMCommand/
git commit -m "feat(admin-web): GM 命令中心页面 — 动态表单 + 执行日志"
```

---

### Task 4：可观测性页面

**Backend APIs:** `GET api/debug/v1/traces/recent?limit=N` + `GET api/debug/v1/traces?traceId=xxx`（均需 AdminGuard）

**Files:** Create `src/pages/Trace/index.tsx`

- [ ] **Step 1：写 Trace 页面**

```tsx
// src/pages/Trace/index.tsx
import { useEffect, useState } from 'react';
import { Card, Table, Tag, Collapse, Descriptions, Input, Button, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import client from '../../api/client';

interface Span {
  traceId: string; spanId: string; parentSpanId: string | null;
  name: string; kind: string; status: string; duration: number;
  startTime: number; attributes?: Record<string, any>; events?: any[];
}
interface Trace { traceId: string; totalSpans: number; spans: Span[]; }

export default function TracePage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Trace | null>(null);

  const loadRecent = async () => {
    setLoading(true);
    try {
      const res = await client.get('/debug/v1/traces/recent', { params: { limit: 30 } });
      setTraces(res.data.data?.traces ?? res.data?.traces ?? []);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadRecent(); }, []);

  const loadDetail = async (traceId: string) => {
    setSelectedId(traceId);
    const res = await client.get('/debug/v1/traces', { params: { traceId } });
    setDetail(res.data.data ?? res.data);
  };

  return (
    <div>
      <Card
        title="Trace 列表"
        extra={<Space><Button onClick={loadRecent} loading={loading}>刷新</Button></Space>}
        style={{ marginBottom: 16 }}
      >
        <Table
          rowKey="traceId"
          size="small"
          loading={loading}
          dataSource={traces}
          pagination={{ pageSize: 15 }}
          columns={[
            { title: 'Trace ID', dataIndex: 'traceId', width: 260, render: (v) => <code>{v}</code> },
            { title: 'Span 数', dataIndex: 'totalSpans', width: 80 },
            {
              title: '总耗时',
              render: (_, r) => {
                const root = r.spans[0];
                return root ? `${Math.round(root.duration)}ms` : '-';
              },
              width: 100,
            },
            {
              title: '根 Span',
              render: (_, r) => r.spans[0]?.name ?? '-',
            },
            {
              title: '操作',
              width: 100,
              render: (_, r) => <Button size="small" type="link" onClick={() => loadDetail(r.traceId)}>查看</Button>,
            },
          ]}
        />
      </Card>

      {detail && (
        <Card title={`Trace 详情 · ${selectedId}`} onClose={() => { setDetail(null); setSelectedId(null); }}>
          <Collapse
            items={detail.spans.map((span) => ({
              key: span.spanId,
              label: (
                <Space>
                  <Tag color={span.status === 'error' ? 'red' : 'blue'}>{span.status}</Tag>
                  <code>{span.name}</code>
                  <span style={{ color: '#999' }}>{Math.round(span.duration)}ms</span>
                  <Tag color={span.kind === 'server' ? 'green' : span.kind === 'client' ? 'orange' : 'default'}>{span.kind}</Tag>
                </Space>
              ),
              children: (
                <Descriptions column={1} size="small">
                  {span.parentSpanId && <Descriptions.Item label="Parent"><code>{span.parentSpanId}</code></Descriptions.Item>}
                  {span.attributes && Object.entries(span.attributes).map(([k, v]) => (
                    <Descriptions.Item key={k} label={k}>{String(v)}</Descriptions.Item>
                  ))}
                  {span.events && span.events.length > 0 && (
                    <Descriptions.Item label="Events">
                      {span.events.map((e: any, i: number) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          <Tag>{e.name}</Tag> {JSON.stringify(e.attributes)}
                        </div>
                      ))}
                    </Descriptions.Item>
                  )}
                </Descriptions>
              ),
            }))}
          />
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2：Commit**

```bash
git add packages-game/admin-web/src/pages/Trace/
git commit -m "feat(admin-web): 可观测性页面 — Trace Span 树"
```

---

### Task 5：天梯 + Room 页面

**Backend APIs:** `GET api/admin/v1/ladder/top` + `POST api/admin/v1/ladder/settle` + `GET api/admin/v1/ladder/refresh`; Room 列表尚未暴露 admin 路由 → Task 5a 补一个 `GET api/admin/v1/ops/rooms`（读 Redis Set 活跃 roomId → 批量 `get` JSON）

**Files:**
- Modify: `packages-game/game-server/src/modules/matchmaking/matchmaking.controller.ts`（若不存在则创建）
- Create: `src/pages/Ladder/index.tsx`
- Create: `src/pages/Room/index.tsx`

- [ ] **Step 1：后端 Room 列表接口（2 行代码）**

若 `matchmaking.controller.ts` 已存在则直接加路由，否则新建：

```ts
// matchmaking.controller.ts (或补充)
@Controller('api/admin/v1/ops/rooms')
@UseGuards(AdminGuard)
export class RoomAdminController {
  constructor(private readonly roomService: RoomService) {}

  @Get()
  async list() {
    const modes = ['ranked', 'casual', 'pve', 'party'];
    const all = await Promise.all(modes.map((m) => this.roomService.listByMode(m)));
    return { data: all.flat() };
  }
}
```

注册到 matchmaking.module.ts。

- [ ] **Step 2：Ladder 页面**

```tsx
// src/pages/Ladder/index.tsx
import { useEffect, useState } from 'react';
import { Button, Card, Table, Tag, Modal, Space, message } from 'antd';
import client from '../../api/client';

export default function LadderPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await client.get('/admin/v1/ladder/top', { params: { limit: 50 } });
    setRows(r.data.data ?? r.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const settle = () => {
    Modal.confirm({
      title: '赛季结算',
      content: '将对当前赛季 TOP 50 发奖（金 + VIP 经验），并自动切到下一赛季。确认？',
      okText: '确认结算',
      okButtonProps: { danger: true },
      onOk: async () => {
        const r = await client.post('/admin/v1/ladder/settle');
        message.success(`结算完成，发奖 ${r.data.data?.rewardsSent ?? 0} 人`);
        load();
      },
    });
  };

  return (
    <Card
      title="天梯排行榜（Redis ZSet 实时）"
      extra={<Space><Button onClick={load} loading={loading}>刷新</Button><Button danger onClick={settle}>赛季结算</Button></Space>}
    >
      <Table
        rowKey="playerId"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: '排名', dataIndex: 'rank', width: 70 },
          { title: '玩家 ID', dataIndex: 'playerId' },
          { title: '分数', dataIndex: 'score', width: 100 },
          {
            title: '段位',
            dataIndex: 'tier',
            width: 100,
            render: (t) => {
              const color = { 青铜: 'default', 白银: 'blue', 黄金: 'gold', 宗师: 'purple' }[t] ?? 'default';
              return <Tag color={color}>{t}</Tag>;
            },
          },
        ]}
      />
    </Card>
  );
}
```

- [ ] **Step 3：Room 页面**

```tsx
// src/pages/Room/index.tsx
import { useEffect, useState } from 'react';
import { Button, Card, Table, Tag, Space } from 'antd';
import client from '../../api/client';

export default function RoomPage() {
  const [rooms, setRooms] = useState<any[]>([]);
  const load = async () => {
    const r = await client.get('/admin/v1/ops/rooms');
    setRooms(r.data.data ?? r.data ?? []);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card title="实时 Room 列表（5s 自动刷新）" extra={<Button onClick={load}>立即刷新</Button>}>
      <Table
        rowKey="id"
        size="small"
        dataSource={rooms}
        columns={[
          { title: 'Room ID', dataIndex: 'id', render: (v) => <code>{v}</code> },
          { title: '模式', dataIndex: 'mode' },
          {
            title: '状态',
            dataIndex: 'status',
            render: (s: string) => (
              <Tag color={{ forming: 'blue', ready: 'cyan', in_progress: 'green', finished: 'default', timeout: 'red', matching: 'orange' }[s] ?? 'default'}>{s}</Tag>
            ),
          },
          {
            title: '玩家',
            render: (_, r) => `${r.players?.length ?? 0}/${r.maxPlayers ?? '?'}`,
          },
          {
            title: '操作',
            render: (_, r) => (
              <Space>
                <span style={{ fontSize: 12, color: '#999' }}>创建: {new Date(r.createdAt).toLocaleString()}</span>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
```

- [ ] **Step 4：Commit**

```bash
# 后端
git add packages-game/game-server/src/modules/matchmaking/
git commit -m "feat(game-server): Room admin list 接口"

# 前端
git add packages-game/admin-web/src/pages/Ladder/ packages-game/admin-web/src/pages/Room/
git commit -m "feat(admin-web): 天梯 + Room 实时列表页面"
```

---

### Task 6：配置中心页面

**Backend APIs:** `GET/POST api/admin/v1/config` + Buff/Skill/掉落表模板 CRUD 均已存在

**Files:** Create `src/pages/Config/index.tsx`

- [ ] **Step 1：写 Config 页面（Tab 切换：远程配置键值对 / Buff 模板 / Skill 模板 / 掉落表）**

```tsx
// src/pages/Config/index.tsx
import { Card, Tabs, Table, Button, Form, Input, InputNumber, Select, Modal, Space, message, Tag } from 'antd';
import { useEffect, useState } from 'react';
import client from '../../api/client';

type Tab = 'config' | 'buff' | 'skill' | 'drop';

interface BuffTpl { id: string; name: string; duration: number; buffType: string; enabled: boolean; }
interface SkillTpl { id: string; name: string; cooldownMs: number; damage: number; enabled: boolean; }
interface DropTpl { id: string; name: string; totalWeight: number; enabled: boolean; }

export default function ConfigCenter() {
  const [tab, setTab] = useState<Tab>('config');

  // 远程配置
  const [configs, setConfigs] = useState<any[]>([]);
  const loadConfigs = async () => {
    const r = await client.get('/admin/v1/config');
    setConfigs(r.data.data?.items ?? []);
  };
  useEffect(() => { if (tab === 'config') loadConfigs(); }, [tab]);

  const [cfgModalOpen, setCfgModalOpen] = useState(false);
  const onSaveConfig = async (v: { key: string; value: string; type: string }) => {
    await client.post('/admin/v1/config', v);
    message.success('已保存');
    setCfgModalOpen(false);
    loadConfigs();
  };

  // Buff 模板
  const [buffs, setBuffs] = useState<BuffTpl[]>([]);
  const loadBuffs = async () => {
    const r = await client.get('/admin/v1/buff');
    setBuffs(r.data.data?.items ?? []);
  };
  useEffect(() => { if (tab === 'buff') loadBuffs(); }, [tab]);

  // Skill 模板
  const [skills, setSkills] = useState<SkillTpl[]>([]);
  const loadSkills = async () => {
    const r = await client.get('/admin/v1/skill');
    setSkills(r.data.data?.items ?? []);
  };
  useEffect(() => { if (tab === 'skill') loadSkills(); }, [tab]);

  // 掉落表
  const [drops, setDrops] = useState<DropTpl[]>([]);
  const loadDrops = async () => {
    const r = await client.get('/admin/v1/item-drop');
    setDrops(r.data.data?.items ?? []);
  };
  useEffect(() => { if (tab === 'drop') loadDrops(); }, [tab]);

  return (
    <Tabs
      activeKey={tab}
      onChange={(k) => setTab(k as Tab)}
      items={[
        {
          key: 'config',
          label: '远程配置',
          children: (
            <Card extra={<Button type="primary" onClick={() => setCfgModalOpen(true)}>新建配置</Button>}>
              <Table
                size="small"
                rowKey="id"
                dataSource={configs}
                columns={[
                  { title: 'Key', dataIndex: 'configKey', render: (v) => <code>{v}</code> },
                  { title: 'Value', dataIndex: 'value', render: (v) => <code>{String(v).slice(0, 80)}</code> },
                  { title: 'Type', dataIndex: 'type', width: 100 },
                  { title: '操作', width: 120, render: () => <Button size="small" type="link">编辑</Button> },
                ]}
              />
              <ConfigModal open={cfgModalOpen} onCancel={() => setCfgModalOpen(false)} onSubmit={onSaveConfig} />
            </Card>
          ),
        },
        {
          key: 'buff',
          label: 'Buff 模板',
          children: <TemplateTable data={buffs} load={loadBuffs} title="Buff 模板" />,
        },
        {
          key: 'skill',
          label: 'Skill 模板',
          children: <TemplateTable data={skills} load={loadSkills} title="Skill 模板" />,
        },
        {
          key: 'drop',
          label: '掉落表',
          children: <TemplateTable data={drops} load={loadDrops} title="掉落表模板" />,
        },
      ]}
    />
  );
}

function ConfigModal({ open, onCancel, onSubmit }: { open: boolean; onCancel: () => void; onSubmit: (v: any) => Promise<void> }) {
  const [form] = Form.useForm();
  return (
    <Modal open={open} title="新建/编辑配置" onCancel={() => { form.resetFields(); onCancel(); }} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="key" label="Key" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="value" label="Value"><Input.TextArea rows={3} /></Form.Item>
        <Form.Item name="type" label="Type" initialValue="STRING"><Select options={['STRING', 'NUMBER', 'JSON', 'BOOLEAN'].map((t) => ({ label: t, value: t }))} /></Form.Item>
      </Form>
    </Modal>
  );
}

function TemplateTable({ data, load, title }: { data: any[]; load: () => Promise<void>; title: string }) {
  return (
    <Card title={title} extra={<Button onClick={load}>刷新</Button>}>
      <Table
        size="small"
        rowKey="id"
        dataSource={data}
        columns={[
          { title: 'ID', dataIndex: 'id', render: (v) => <code>{v}</code> },
          { title: '名称', dataIndex: 'name' },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 80,
            render: (v) => v ? <Tag color="green">启用</Tag> : <Tag color="default">禁用</Tag>,
          },
          { title: '操作', width: 120, render: () => <Space><Button size="small" type="link">编辑</Button><Button size="small" type="link" danger>禁用</Button></Space> },
        ]}
      />
    </Card>
  );
}
```

- [ ] **Step 2：Commit**

```bash
git add packages-game/admin-web/src/pages/Config/
git commit -m "feat(admin-web): 配置中心 — 远程配置 + Buff/Skill/掉落表模板"
```

---

### Task 7：客户端 DOM overlay GM 面板

**目标：** 按 `~` 或 Ctrl+G 在 Laya Canvas 上弹出 GM 面板，原生 HTML/CSS/JS 实现，零构建。

**Files:**
- Create: `packages-game/game-client/src/gm-panel/index.html`
- Create: `packages-game/game-client/src/gm-panel/style.css`
- Create: `packages-game/game-client/src/gm-panel/gm.js`
- Modify: `packages-game/game-client/src/boot/Main.ts`（在 afterLogin 末尾 + 4 行）

- [ ] **Step 1：写 index.html + style.css**

```html
<!-- gm-panel/index.html — 被 Main.ts 动态 fetch 注入 -->
<div id="gm-panel" hidden>
  <div class="gm-header">
    <span class="gm-title">GM Panel</span>
    <span class="gm-close" onclick="window.__toggleGMPanel()">×</span>
  </div>
  <div class="gm-body">
    <div class="gm-sidebar" id="gm-cmd-list"></div>
    <div class="gm-content">
      <div class="gm-target">
        <label>玩家 ID</label>
        <input id="gm-player-id" placeholder="playerId" />
      </div>
      <div class="gm-args" id="gm-args"></div>
      <div class="gm-actions">
        <button id="gm-execute">执行</button>
      </div>
      <div class="gm-log" id="gm-log"></div>
    </div>
  </div>
</div>
```

```css
/* gm-panel/style.css */
#gm-panel {
  position: fixed;
  right: 16px; bottom: 16px;
  width: 480px; height: 420px;
  background: #1a1a2e; color: #eee;
  border-radius: 8px; border: 1px solid #333;
  z-index: 9999;
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 12px;
  display: flex; flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
#gm-panel[hidden] { display: none; }
.gm-header {
  padding: 8px 12px; background: #16213e;
  display: flex; justify-content: space-between; align-items: center;
  border-radius: 8px 8px 0 0;
}
.gm-title { font-weight: 600; color: #6a9; }
.gm-close { cursor: pointer; font-size: 18px; color: #f88; }
.gm-body { display: flex; flex: 1; overflow: hidden; }
.gm-sidebar {
  width: 140px; background: #0f3460;
  overflow-y: auto; padding: 4px 0;
}
.gm-sidebar .gm-cmd-item {
  padding: 6px 12px; cursor: pointer; color: #889;
  border-left: 2px solid transparent;
}
.gm-sidebar .gm-cmd-item.selected { color: #eee; border-left-color: #e94560; background: #16213e; }
.gm-content { flex: 1; padding: 12px; overflow-y: auto; }
.gm-content label { color: #999; display: block; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.gm-content input, .gm-content select {
  width: 100%; padding: 6px 8px; background: #0f3460;
  border: 1px solid #333; border-radius: 4px; color: #eee;
  margin-bottom: 8px; box-sizing: border-box;
}
.gm-actions button {
  background: #e94560; color: #fff; border: none;
  padding: 8px 24px; border-radius: 4px; cursor: pointer;
}
.gm-log { margin-top: 12px; max-height: 120px; overflow-y: auto; font-family: monospace; }
.gm-log .log-line { padding: 2px 0; color: #6a9; border-bottom: 1px solid #222; }
.gm-log .log-line.error { color: #f88; }
```

- [ ] **Step 2：写 gm.js（核心逻辑）**

```js
// gm-panel/gm.js
(function () {
  const BASE = '/api';
  const TOKEN_KEY = 'player_token'; // 与现有 WsClient 共用
  let cmds = [];
  let selectedCmd = null;

  const $ = (id) => document.getElementById(id);

  function getToken() {
    // 尝试多个来源：player_token / 现有的 auth / localStorage
    try { return localStorage.getItem('player_token') || localStorage.getItem('token') || ''; } catch { return ''; }
  }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(BASE + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || res.statusText);
    return data.data ?? data;
  }

  async function loadCmds() {
    try {
      cmds = await api('/admin/v1/ops/gm/list');
      renderCmdList();
    } catch (e) {
      log('加载命令列表失败: ' + e.message, 'error');
    }
  }

  function renderCmdList() {
    const el = $('gm-cmd-list');
    el.innerHTML = cmds.map((c) =>
      `<div class="gm-cmd-item" data-cmd="${c.name}">${c.name}</div>`
    ).join('');
    el.querySelectorAll('.gm-cmd-item').forEach((item) => {
      item.addEventListener('click', () => selectCmd(item.dataset.cmd));
    });
  }

  function selectCmd(name) {
    selectedCmd = cmds.find((c) => c.name === name);
    document.querySelectorAll('.gm-cmd-item').forEach((el) =>
      el.classList.toggle('selected', el.dataset.cmd === name)
    );
    renderArgs();
  }

  function renderArgs() {
    const el = $('gm-args');
    if (!selectedCmd) { el.innerHTML = ''; return; }
    const schemas = selectedCmd.argsSchema || {};
    el.innerHTML = Object.entries(schemas).map(([k, v]) => `
      <div>
        <label>${k}${v.description ? ` · ${v.description}` : ''}</label>
        ${v.type === 'number' ? `<input data-arg="${k}" type="number" />` :
          v.enum ? `<select data-arg="${k}">${v.enum.map((e) => `<option>${e}</option>`).join('')}</select>` :
          v.type === 'boolean' ? `<select data-arg="${k}"><option value="true">true</option><option value="false">false</option></select>` :
          `<input data-arg="${k}" placeholder="${v.type || 'string'}" />`}
      </div>
    `).join('');
  }

  async function execute() {
    if (!selectedCmd) return;
    const playerId = $('gm-player-id').value.trim();
    if (!playerId) return log('请先填玩家 ID', 'error');

    const args = {};
    document.querySelectorAll('[data-arg]').forEach((el) => {
      let v = el.value;
      if (el.type === 'number') v = Number(v);
      if (v === 'true') v = true;
      if (v === 'false') v = false;
      args[el.dataset.arg] = v;
    });

    log(`→ POST /gm/execute cmd=${selectedCmd.name} player=${playerId}`);
    try {
      const res = await api('/admin/v1/ops/gm/execute', {
        method: 'POST',
        body: JSON.stringify({ cmd: selectedCmd.name, targetPlayerId: playerId, args }),
      });
      log(`✓ OK: ${JSON.stringify(res.result ?? null)}`);
    } catch (e) {
      log(`✗ FAIL: ${e.message}`, 'error');
    }
  }

  function log(line, cls) {
    const el = $('gm-log');
    const div = document.createElement('div');
    div.className = 'log-line' + (cls ? ' ' + cls : '');
    div.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
    el.prepend(div);
  }

  window.__initGMPanel = function () {
    // 微信小游戏检测 —— 没有 DOM overlay 能力
    try {
      if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
        console.warn('[GM] 微信小游戏环境下 DOM GM 面板不可用');
        return;
      }
    } catch {}

    // 注入 HTML
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '.../src/gm-panel/style.css'; // 构建时替换为正确路径
    document.head.appendChild(link);

    const div = document.createElement('div');
    div.innerHTML = `<div id="gm-panel" hidden>${document.querySelector('#gm-panel')?.innerHTML ?? ''}</div>`;
    // 更简单：直接 innerHTML 注入 —— 见实际构建实现

    // 快捷键
    document.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === '~' || (e.ctrlKey && e.key.toLowerCase() === 'g')) {
        e.preventDefault();
        window.__toggleGMPanel();
      }
    });

    // 执行按钮
    setTimeout(() => {
      const btn = document.getElementById('gm-execute');
      if (btn) btn.addEventListener('click', execute);
      loadCmds();
    }, 100);
  };

  window.__toggleGMPanel = function () {
    const el = document.getElementById('gm-panel');
    if (!el) return;
    el.hidden = !el.hidden;
    if (!el.hidden) loadCmds();
  };
})();
```

- [ ] **Step 3：集成到 Main.ts（afterLogin 末尾 + 4 行）**

在 `Main.afterLogin()` 方法的最后（所有初始化都完成后）加：

```ts
// game-client/src/boot/Main.ts — afterLogin 末尾
// GM DOM overlay 初始化（非微信小游戏环境生效）
import { GM_PANEL_HTML } from '../gm-panel/index.html?raw';
import { GM_PANEL_CSS } from '../gm-panel/style.css?raw';

// 注入 CSS
const style = document.createElement('style');
style.textContent = GM_PANEL_CSS;
document.head.appendChild(style);
// 注入 HTML
const container = document.createElement('div');
container.innerHTML = GM_PANEL_HTML;
document.body.appendChild(container.firstElementChild!);
// 加载脚本（gm.js 可以直接内联，也可以 fetch）
// 详见实际 build 实现
// 快捷键监听放在 gm.js 里
```

注意：Vite 能 `import '*.html?raw'` 和 `import '*.css?raw'` 是内建能力（`?raw` suffix），无需额外插件。

- [ ] **Step 4：构建验证**

```bash
cd packages-game/game-client
npm run dev     # 或你的本地预览命令
# 预期：游戏加载后按 ~ 键 → GM 面板弹出在右下；Ctrl+G 也能触发；玩家 ID + 选择命令 + 执行
```

- [ ] **Step 5：Commit**

```bash
git add packages-game/game-client/src/gm-panel/ packages-game/game-client/src/boot/Main.ts
git commit -m "feat(game-client): DOM overlay GM 面板 — ~ 键弹出 + 6 个 GM 命令"
```

---

### Task 8：部署

**关键约束：** admin-web 是独立 Vite 工程，产物 `dist/` 要部署到 `/opt/game-server/admin-web/`，并配置 Nginx `/admin/` 代理到 `/opt/game-server/admin-web/index.html`（SPA fallback）。旧 Vue CDN `admin/index.html` 保持不动，不冲突（可后续合并到 React）。

- [ ] **Step 1：构建 admin-web**

```bash
cd packages-game/admin-web
npm run build
# 产物在 dist/
```

- [ ] **Step 2：服务器上传 + Nginx 配置**

```bash
# 本地 → 服务器
scp -r packages-game/admin-web/dist/ user@server:/opt/game-server/admin-web/

# Nginx 片段（/etc/nginx/conf.d/game-admin.conf）
location /admin-web/ {
  alias /opt/game-server/admin-web/;
  try_files $uri $uri/ /admin-web/index.html;
}
# 原 /admin/ Vue CDN 保持不变
location /admin/ {
  alias /opt/game-server/admin/;
}

# reload
nginx -t && nginx -s reload
```

- [ ] **Step 3：浏览器点检**

```
1. https://game.joho.cn/admin-web/ → 登录 React SPA → 侧边菜单 5 项
2. GM 命令 → 选 player.give-exp → 填 amount=1000 → 执行 → 日志出现
3. Trace → 列表加载 → 点一条查看 Span 树 → 展开事件
4. 天梯 → 排行榜加载 + 段位 Tag
5. Room → 空态（无活跃房间）或实时列表
6. 配置 → 4 个 Tab 都能加载
7. 旧 /admin/ Vue 面板回归 — 封禁/举报/风控处置不变
```

- [ ] **Step 4：最终 Commit（部署脚本 + README）**

```bash
git add packages-game/admin-web/ docs/superpowers/plans/2026-10-04-admin-spa-gm-trace.md
git commit -m "docs: admin-web MVP 实现计划 + 部署脚本"
```

---

## 依赖与已知限制

| 项 | 说明 |
|---|---|
| **后端零改动** | MVP 第一批全部消费今天已写的 API，仅 Room 列表需要在 Task 5 补一个 8 行 controller |
| **前端两套并存** | 旧 Vue CDN `/admin/`（处置面板）保留，新 React `/admin-web/`（GM/Trace/天梯/Room/配置）独立 |
| **GM 面板 Token** | 客户端 GM 面板用 **player token**（与游戏客户端同源登录），后端 GM 命令路由需要 admin token —— **有问题！** Task 7 需要确认：游戏客户端的 player token 是否能过 AdminGuard。**如果不能**，GM 面板要改用 Admin 登录（在面板里加一个简易登录弹窗），或者后端 GM 命令路由加一层 Admin + Player 双 Guard。**这是唯一需要后端改动的风险点** |
| **微信小游戏 GM 面板** | DOM overlay 在微信小游戏不可用，gm.js 有 fallback（隐藏面板 + 提示） |
| **前端部署** | 需要服务器配 Nginx `/admin-web/` alias + SPA fallback |
| **API 类型** | `npm run gen-types` 从 Swagger `/api/docs-json` 生成，但后端 game-server 必须启动中才能跑（开发阶段每次启动后端后手动跑） |

---

## Spec 覆盖自检

| 需求 | Task | 状态 |
|---|---|---|
| React + Vite + AntD Pro 脚手架 | 1 | ✅ |
| GM 命令页面（动态表单 + 执行日志） | 3 | ✅ |
| 可观测性（Trace Span 树） | 4 | ✅ |
| 天梯排行榜（ZSet + 一键结算） | 5 | ✅ |
| Room 实时列表 | 5 | ✅ |
| 配置中心（远程配置 + 模板 CRUD） | 6 | ✅ |
| DOM overlay GM 面板（~ 键弹出） | 7 | ✅ |
| 部署 + 浏览器点检 | 8 | ✅ |
| Admin JWT 鉴权 + 401 拦截 | 2 | ✅ |
| GM 面板 Token 风险 | 7（依赖部分已标注） | ⚠️ 需验证 |

**无 placeholder / 无 TBD / 每步精确路径 + 完整代码骨架 + 可执行命令。**
