import { useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface NpcRule {
  id: number;
  sceneId: number;
  templateId: number;
  spawnRate: number;
  isActive: boolean;
}

interface NpcRoute {
  id: number;
  routeName: string;
  waypoints: any[];
}

function JsonTextarea({ value, onChange, rows = 4 }: any) {
  const [err, setErr] = useState<string | null>(null);
  const display = value !== undefined ? (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) : '';

  const handle = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    try {
      const parsed = JSON.parse(raw);
      setErr(null);
      onChange?.(parsed);
    } catch {
      setErr('JSON 格式无效');
      onChange?.(raw);
    }
  };

  return (
    <>
      <Input.TextArea rows={rows} defaultValue={display} onChange={handle} />
      {err && <div style={{ color: 'red', marginTop: 4, fontSize: 12 }}>{err}</div>}
    </>
  );
}

export default function NpcPage() {
  const [rulesReloadKey, setRulesReloadKey] = useState(0);
  const [routesReloadKey, setRoutesReloadKey] = useState(0);

  // Rules
  const [ruleEditOpen, setRuleEditOpen] = useState(false);
  const [ruleCreateOpen, setRuleCreateOpen] = useState(false);
  const [currentRule, setCurrentRule] = useState<NpcRule | null>(null);
  const [ruleForm] = Form.useForm();

  // Routes
  const [routeEditOpen, setRouteEditOpen] = useState(false);
  const [routeCreateOpen, setRouteCreateOpen] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<NpcRoute | null>(null);
  const [routeForm] = Form.useForm();

  const fetchRules = (_page?: number, _limit?: number) =>
    client.get('/admin/v1/world/npc-rules/list');

  const fetchRoutes = (_page?: number, _limit?: number) =>
    client.get('/admin/v1/world/npc-routes/list');

  const toggleRule = async (record: NpcRule) => {
    try {
      await client.patch(`/admin/v1/world/npc-rules/${record.id}/toggle`);
      message.success('已切换启停');
      setRulesReloadKey((k) => k + 1);
    } catch {
      // 拦截器已提示
    }
  };

  const deleteRule = async (record: NpcRule) => {
    try {
      await client.delete(`/admin/v1/world/npc-rules/${record.id}`);
      message.success('删除成功');
      setRulesReloadKey((k) => k + 1);
    } catch {
      // 拦截器已提示
    }
  };

  const openRuleEdit = (record: NpcRule) => {
    setCurrentRule(record);
    ruleForm.setFieldsValue(record);
    setRuleEditOpen(true);
  };

  const openRuleCreate = () => {
    setCurrentRule(null);
    ruleForm.resetFields();
    setRuleCreateOpen(true);
  };

  const handleRuleSubmit = async () => {
    const values = await ruleForm.validateFields();
    try {
      if (currentRule) {
        await client.patch(`/admin/v1/world/npc-rules/${currentRule.id}`, values);
        message.success('更新成功');
        setRuleEditOpen(false);
      } else {
        await client.post('/admin/v1/world/npc-rules', values);
        message.success('创建成功');
        setRuleCreateOpen(false);
      }
      setRulesReloadKey((k) => k + 1);
    } catch {
      // 拦截器已提示
    }
  };

  // --- Routes ---
  const deleteRoute = async (record: NpcRoute) => {
    try {
      await client.delete(`/admin/v1/world/npc-routes/${record.id}`);
      message.success('删除成功');
      setRoutesReloadKey((k) => k + 1);
    } catch {
      // 拦截器已提示
    }
  };

  const openRouteEdit = (record: NpcRoute) => {
    setCurrentRoute(record);
    routeForm.setFieldsValue({
      ...record,
      waypoints: record.waypoints ? JSON.stringify(record.waypoints, null, 2) : '',
    });
    setRouteEditOpen(true);
  };

  const openRouteCreate = () => {
    setCurrentRoute(null);
    routeForm.resetFields();
    setRouteCreateOpen(true);
  };

  const handleRouteSubmit = async () => {
    const values = await routeForm.validateFields();
    let waypoints = values.waypoints;
    if (typeof waypoints === 'string') {
      try {
        waypoints = JSON.parse(waypoints);
      } catch {
        message.error('waypoints 不是有效 JSON');
        return;
      }
    }
    const payload = { ...values, waypoints };
    try {
      if (currentRoute) {
        await client.patch(`/admin/v1/world/npc-routes/${currentRoute.id}`, payload);
        message.success('更新成功');
        setRouteEditOpen(false);
      } else {
        await client.post('/admin/v1/world/npc-routes', payload);
        message.success('创建成功');
        setRouteCreateOpen(false);
      }
      setRoutesReloadKey((k) => k + 1);
    } catch {
      // 拦截器已提示
    }
  };

  const ruleColumns: ColumnsType<NpcRule> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '场景 ID', dataIndex: 'sceneId', width: 100 },
    { title: '模板 ID', dataIndex: 'templateId', width: 100 },
    { title: '生成率', dataIndex: 'spawnRate', width: 100 },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 100,
      render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, r) => (
        <Space>
          <Button size="small" onClick={() => toggleRule(r)}>
            {r.isActive ? '停用' : '启用'}
          </Button>
          <Button size="small" onClick={() => openRuleEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => deleteRule(r)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const routeColumns: ColumnsType<NpcRoute> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '路径名', dataIndex: 'routeName' },
    {
      title: '航点',
      dataIndex: 'waypoints',
      render: (w) => (Array.isArray(w) ? `${w.length} 个点` : JSON.stringify(w).slice(0, 60)),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, r) => (
        <Space>
          <Button size="small" onClick={() => openRouteEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => deleteRoute(r)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Tabs
        defaultActiveKey="rules"
        items={[
          {
            key: 'rules',
            label: '生成规则',
            children: (
              <AdminTable<NpcRule>
                rowKey="id"
                title="NPC 生成规则"
                columns={ruleColumns}
                fetchFn={fetchRules}
                deps={[rulesReloadKey]}
                extra={
                  <Button type="primary" onClick={openRuleCreate}>
                    新建规则
                  </Button>
                }
              />
            ),
          },
          {
            key: 'routes',
            label: '巡逻路径',
            children: (
              <AdminTable<NpcRoute>
                rowKey="id"
                title="NPC 巡逻路径"
                columns={routeColumns}
                fetchFn={fetchRoutes}
                deps={[routesReloadKey]}
                extra={
                  <Button type="primary" onClick={openRouteCreate}>
                    新建路径
                  </Button>
                }
              />
            ),
          },
        ]}
      />

      {/* Rule Edit/Create */}
      <Modal
        open={ruleEditOpen}
        onCancel={() => setRuleEditOpen(false)}
        onOk={handleRuleSubmit}
        title="编辑规则"
        destroyOnClose
      >
        <Form form={ruleForm} layout="vertical">
          <Form.Item label="场景 ID" name="sceneId" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="模板 ID" name="templateId" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="生成率 (0-1)" name="spawnRate" rules={[{ required: true }]}>
            <InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="是否启用" name="isActive" valuePropName="checked">
            <Form.Item name="isActive" noStyle>
              <Input type="checkbox" />
            </Form.Item>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={ruleCreateOpen}
        onCancel={() => setRuleCreateOpen(false)}
        onOk={handleRuleSubmit}
        title="新建规则"
        destroyOnClose
      >
        <Form form={ruleForm} layout="vertical">
          <Form.Item label="场景 ID" name="sceneId" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="模板 ID" name="templateId" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="生成率 (0-1)" name="spawnRate" rules={[{ required: true }]}>
            <InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Route Edit/Create */}
      <Modal
        open={routeEditOpen}
        onCancel={() => setRouteEditOpen(false)}
        onOk={handleRouteSubmit}
        title="编辑路径"
        destroyOnClose
        width={600}
      >
        <Form form={routeForm} layout="vertical">
          <Form.Item label="路径名" name="routeName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="航点 (JSON 数组)" name="waypoints">
            <Input.TextArea rows={6} placeholder='[{"x":0,"y":0},{"x":10,"y":10}]' />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={routeCreateOpen}
        onCancel={() => setRouteCreateOpen(false)}
        onOk={handleRouteSubmit}
        title="新建路径"
        destroyOnClose
        width={600}
      >
        <Form form={routeForm} layout="vertical">
          <Form.Item label="路径名" name="routeName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="航点 (JSON 数组)" name="waypoints">
            <Input.TextArea rows={6} placeholder='[{"x":0,"y":0},{"x":10,"y":10}]' />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
