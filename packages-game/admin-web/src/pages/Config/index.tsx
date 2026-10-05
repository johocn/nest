import { useEffect, useState } from 'react';
import {
  Tabs,
  Card,
  Table,
  Button,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  message,
  Popconfirm,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import client from '../../api/client';

// ============ Config 类型 ============
interface ConfigItem {
  id?: number;
  configKey: string;
  value: string;
  type: 'STRING' | 'NUMBER' | 'JSON' | 'BOOLEAN';
}

// ============ Tab 1: 远程配置 ============
function ConfigTab() {
  const [data, setData] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConfigItem | null>(null);
  const [form] = Form.useForm<ConfigItem>();

  const load = async () => {
    setLoading(true);
    try {
      const r = await client.get('/admin/v1/config/list');
      setData(r.data?.data?.items ?? r.data?.data ?? []);
    } catch {
      // 拦截器已处理
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'STRING', value: '' });
    setModalOpen(true);
  };

  const openEdit = (record: ConfigItem) => {
    setEditing(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await client.put(`/admin/v1/config/${editing.id ?? editing.configKey}`, values);
        message.success('更新成功');
      } else {
        await client.post('/admin/v1/config', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      load();
    } catch {
      // 拦截器处理
    }
  };

  const handleDelete = async (record: ConfigItem) => {
    try {
      await client.delete(`/admin/v1/config/${record.id ?? record.configKey}`);
      message.success('删除成功');
      load();
    } catch {
      // 拦截器处理
    }
  };

  const columns: ColumnsType<ConfigItem> = [
    {
      title: 'Key',
      dataIndex: 'configKey',
      key: 'configKey',
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: 'Value',
      dataIndex: 'value',
      key: 'value',
      ellipsis: true,
      render: (v: string) => (
        <code style={{ fontSize: 12 }}>{String(v).length > 80 ? String(v).slice(0, 80) + '…' : v}</code>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除此配置?" onConfirm={() => handleDelete(record)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title="远程配置"
        extra={<Button type="primary" onClick={openCreate}>新建配置</Button>}
      >
        <Table<ConfigItem>
          rowKey={(r) => String(r.id ?? r.configKey)}
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editing ? `编辑配置: ${editing.configKey}` : '新建配置'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="配置 Key"
            name="configKey"
            rules={[{ required: true, message: '请输入配置 Key' }]}
          >
            <Input placeholder="如: game.server.maxPlayers" disabled={!!editing} />
          </Form.Item>
          <Form.Item label="类型" name="type" rules={[{ required: true }]}>
            <Select
              options={[
                { label: 'STRING', value: 'STRING' },
                { label: 'NUMBER', value: 'NUMBER' },
                { label: 'JSON', value: 'JSON' },
                { label: 'BOOLEAN', value: 'BOOLEAN' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Value" name="value">
            <Input.TextArea rows={5} placeholder="请输入配置值" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ============ Buff 模板 Tab ============
interface BuffTemplate {
  id?: number;
  name: string;
  buffType: 'buff' | 'debuff';
  target: 'self' | 'target';
  duration: number;
  statModifiers?: Record<string, number>;
  description?: string;
  iconKey?: string;
}

function BuffTemplateTab() {
  const [data, setData] = useState<BuffTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BuffTemplate | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const r = await client.get('/admin/v1/buff/template/list');
      setData(r.data?.data?.items ?? r.data?.data ?? []);
    } catch {
      // 拦截器处理
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      buffType: 'buff',
      target: 'self',
      duration: 3,
      statModifiers: '{}',
    });
    setModalOpen(true);
  };

  const openEdit = (record: BuffTemplate) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      statModifiers: record.statModifiers ? JSON.stringify(record.statModifiers) : '{}',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload: any = { ...values };
      if (typeof payload.statModifiers === 'string' && payload.statModifiers.trim()) {
        try {
          payload.statModifiers = JSON.parse(payload.statModifiers);
        } catch {
          message.error('statModifiers 必须是合法 JSON');
          return;
        }
      } else {
        payload.statModifiers = {};
      }

      if (editing) {
        await client.put(`/admin/v1/buff/template/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await client.post('/admin/v1/buff/template', payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      load();
    } catch {
      // 拦截器处理
    }
  };

  const handleDelete = async (record: BuffTemplate) => {
    try {
      await client.delete(`/admin/v1/buff/template/${record.id}`);
      message.success('删除成功');
      load();
    } catch {
      // 拦截器处理
    }
  };

  const columns: ColumnsType<BuffTemplate> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      render: (v) => <code>{String(v)}</code>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'buffType',
      key: 'buffType',
      width: 100,
      render: (v: string) =>
        v === 'buff' ? (
          <Tag color="green">buff</Tag>
        ) : (
          <Tag color="red">debuff</Tag>
        ),
    },
    {
      title: '目标',
      dataIndex: 'target',
      key: 'target',
      width: 100,
    },
    {
      title: '持续(秒)',
      dataIndex: 'duration',
      key: 'duration',
      width: 110,
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除此 Buff 模板?" onConfirm={() => handleDelete(record)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title="Buff 模板"
        extra={<Button type="primary" onClick={openCreate}>新建模板</Button>}
      >
        <Table<BuffTemplate>
          rowKey={(r) => String(r.id ?? r.name)}
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editing ? `编辑 Buff: ${editing.name}` : '新建 Buff 模板'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如: 狂暴、中毒" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item label="类型" name="buffType" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select
                options={[
                  { label: 'buff (增益)', value: 'buff' },
                  { label: 'debuff (减益)', value: 'debuff' },
                ]}
              />
            </Form.Item>
            <Form.Item label="目标" name="target" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select
                options={[
                  { label: '自身 (self)', value: 'self' },
                  { label: '目标 (target)', value: 'target' },
                ]}
              />
            </Form.Item>
            <Form.Item label="持续(秒)" name="duration" rules={[{ required: true }]} style={{ width: 160 }}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item
            label="属性修改 (statModifiers)"
            name="statModifiers"
            tooltip='JSON 对象，如 {"strength":5,"agility":3}'
          >
            <Input.TextArea
              rows={4}
              placeholder='{"strength":5,"agility":3}'
            />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="图标 Key" name="iconKey">
            <Input placeholder="如: buff.fury" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ============ Skill 模板 Tab ============
interface SkillTemplate {
  id?: number;
  name: string;
  skillType: 'active' | 'passive';
  artType?: 'fist' | 'palm' | 'leg' | 'weapon';
  baseDamage: number;
  cooldown: number;
  mpCost: number;
  range: number;
  effectJson?: Record<string, unknown>;
  minLevel?: number;
}

function SkillTemplateTab() {
  const [data, setData] = useState<SkillTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SkillTemplate | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const r = await client.get('/admin/v1/skill/template/list');
      setData(r.data?.data?.items ?? r.data?.data ?? []);
    } catch {
      // 拦截器处理
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      skillType: 'active',
      baseDamage: 0,
      cooldown: 0,
      mpCost: 0,
      range: 1,
      effectJson: '{}',
      minLevel: 1,
    });
    setModalOpen(true);
  };

  const openEdit = (record: SkillTemplate) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      effectJson: record.effectJson ? JSON.stringify(record.effectJson) : '{}',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload: any = { ...values };
      if (typeof payload.effectJson === 'string' && payload.effectJson.trim()) {
        try {
          payload.effectJson = JSON.parse(payload.effectJson);
        } catch {
          message.error('effectJson 必须是合法 JSON');
          return;
        }
      } else {
        payload.effectJson = {};
      }

      if (editing) {
        await client.put(`/admin/v1/skill/template/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await client.post('/admin/v1/skill/template', payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      load();
    } catch {
      // 拦截器处理
    }
  };

  const handleDelete = async (record: SkillTemplate) => {
    try {
      await client.delete(`/admin/v1/skill/template/${record.id}`);
      message.success('删除成功');
      load();
    } catch {
      // 拦截器处理
    }
  };

  const columns: ColumnsType<SkillTemplate> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      render: (v) => <code>{String(v)}</code>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'skillType',
      key: 'skillType',
      width: 100,
      render: (v: string) =>
        v === 'active' ? (
          <Tag color="blue">active</Tag>
        ) : (
          <Tag color="default">passive</Tag>
        ),
    },
    {
      title: '流派',
      dataIndex: 'artType',
      key: 'artType',
      width: 100,
      render: (v?: string) => v ? <Tag>{v}</Tag> : '-',
    },
    {
      title: '伤害',
      dataIndex: 'baseDamage',
      key: 'baseDamage',
      width: 80,
    },
    {
      title: '冷却',
      dataIndex: 'cooldown',
      key: 'cooldown',
      width: 80,
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除此 Skill 模板?" onConfirm={() => handleDelete(record)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title="Skill 模板"
        extra={<Button type="primary" onClick={openCreate}>新建模板</Button>}
      >
        <Table<SkillTemplate>
          rowKey={(r) => String(r.id ?? r.name)}
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editing ? `编辑 Skill: ${editing.name}` : '新建 Skill 模板'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如: 降龙十八掌" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item label="技能类型" name="skillType" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select
                options={[
                  { label: 'active (主动)', value: 'active' },
                  { label: 'passive (被动)', value: 'passive' },
                ]}
              />
            </Form.Item>
            <Form.Item label="流派" name="artType" style={{ width: 180 }}>
              <Select
                allowClear
                placeholder="可选"
                options={[
                  { label: 'fist (拳)', value: 'fist' },
                  { label: 'palm (掌)', value: 'palm' },
                  { label: 'leg (腿)', value: 'leg' },
                  { label: 'weapon (兵刃)', value: 'weapon' },
                ]}
              />
            </Form.Item>
            <Form.Item label="最低等级" name="minLevel" style={{ width: 140 }}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item label="基础伤害" name="baseDamage" rules={[{ required: true }]} style={{ width: 140 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="冷却(秒)" name="cooldown" rules={[{ required: true }]} style={{ width: 140 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="MP 消耗" name="mpCost" rules={[{ required: true }]} style={{ width: 140 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="作用距离" name="range" rules={[{ required: true }]} style={{ width: 120 }}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item
            label="特效 (effectJson)"
            name="effectJson"
            tooltip="JSON 对象，可填写技能附加效果"
          >
            <Input.TextArea
              rows={4}
              placeholder='{"stun":true,"stunDuration":1}'
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ============ Drop 模板 Tab ============
interface DropItem {
  itemTemplateId: string;
  weight: number;
  minQty: number;
  maxQty: number;
}

interface DropTemplate {
  id?: number;
  name: string;
  dropRate: number;
  maxDrops: number;
  dropItems: DropItem[];
}

function DropTemplateTab() {
  const [data, setData] = useState<DropTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DropTemplate | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const r = await client.get('/admin/v1/item-drop/template/list');
      setData(r.data?.data?.items ?? r.data?.data ?? []);
    } catch {
      // 拦截器处理
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      dropRate: 0.5,
      maxDrops: 1,
      dropItems: '[]',
    });
    setModalOpen(true);
  };

  const openEdit = (record: DropTemplate) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      dropItems: record.dropItems ? JSON.stringify(record.dropItems) : '[]',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload: any = { ...values };
      if (typeof payload.dropItems === 'string' && payload.dropItems.trim()) {
        try {
          const parsed = JSON.parse(payload.dropItems);
          if (!Array.isArray(parsed)) {
            message.error('dropItems 必须是数组');
            return;
          }
          payload.dropItems = parsed;
        } catch {
          message.error('dropItems 必须是合法 JSON 数组');
          return;
        }
      } else {
        payload.dropItems = [];
      }

      if (editing) {
        await client.put(`/admin/v1/item-drop/template/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await client.post('/admin/v1/item-drop/template', payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      load();
    } catch {
      // 拦截器处理
    }
  };

  const handleDelete = async (record: DropTemplate) => {
    try {
      await client.delete(`/admin/v1/item-drop/template/${record.id}`);
      message.success('删除成功');
      load();
    } catch {
      // 拦截器处理
    }
  };

  const columns: ColumnsType<DropTemplate> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      render: (v) => <code>{String(v)}</code>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '掉落率',
      dataIndex: 'dropRate',
      key: 'dropRate',
      width: 100,
      render: (v: number) => `${(v * 100).toFixed(0)}%`,
    },
    {
      title: '最多掉落',
      dataIndex: 'maxDrops',
      key: 'maxDrops',
      width: 110,
    },
    {
      title: '掉落项',
      dataIndex: 'dropItems',
      key: 'dropItems',
      width: 110,
      render: (v: DropItem[]) => `${Array.isArray(v) ? v.length : 0} 项`,
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除此掉落表?" onConfirm={() => handleDelete(record)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title="掉落表"
        extra={<Button type="primary" onClick={openCreate}>新建掉落表</Button>}
      >
        <Table<DropTemplate>
          rowKey={(r) => String(r.id ?? r.name)}
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editing ? `编辑掉落表: ${editing.name}` : '新建掉落表'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如: 新手村小怪掉落" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item
              label="掉落率 (0-1)"
              name="dropRate"
              rules={[{ required: true }]}
              style={{ width: 220 }}
              tooltip="0.5 表示 50%"
            >
              <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="最多掉落数量"
              name="maxDrops"
              rules={[{ required: true }]}
              style={{ width: 200 }}
            >
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item
            label="掉落物品列表 (dropItems)"
            name="dropItems"
            rules={[{ required: true, message: '请填写 dropItems JSON 数组' }]}
            tooltip="JSON 数组，每项含 itemTemplateId / weight / minQty / maxQty"
          >
            <Input.TextArea
              rows={8}
              placeholder='[{"itemTemplateId":"1","weight":60,"minQty":0,"maxQty":1}]'
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ============ 主组件 ============
export default function ConfigCenter() {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>配置中心</h2>
      <Tabs
        items={[
          {
            key: 'config',
            label: '远程配置',
            children: <ConfigTab />,
          },
          {
            key: 'buff',
            label: 'Buff 模板',
            children: <BuffTemplateTab />,
          },
          {
            key: 'skill',
            label: 'Skill 模板',
            children: <SkillTemplateTab />,
          },
          {
            key: 'drop',
            label: '掉落表',
            children: <DropTemplateTab />,
          },
        ]}
      />
    </div>
  );
}
