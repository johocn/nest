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
      const r = await client.get('/admin/v1/config');
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

// ============ 通用模板 Tab ============
interface TemplateItem {
  id: number | string;
  name: string;
  enabled?: boolean;
  [key: string]: unknown;
}

function TemplateTab({
  title,
  endpoint,
}: {
  title: string;
  endpoint: string;
}) {
  const [data, setData] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await client.get(`/admin/v1/${endpoint}`);
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

  const columns: ColumnsType<TemplateItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 100,
      render: (v: unknown) => <code>{String(v)}</code>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (v: boolean) =>
        v ? (
          <Tag color="green">启用</Tag>
        ) : (
          <Tag color="default">禁用</Tag>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: () => (
        <Button type="link" size="small" disabled>
          详情
        </Button>
      ),
    },
  ];

  return (
    <Card title={title} extra={<Button onClick={load}>刷新</Button>}>
      <Table<TemplateItem>
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{ pageSize: 10 }}
      />
    </Card>
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
            children: <TemplateTab title="Buff 模板" endpoint="buff" />,
          },
          {
            key: 'skill',
            label: 'Skill 模板',
            children: <TemplateTab title="Skill 模板" endpoint="skill" />,
          },
          {
            key: 'drop',
            label: '掉落表',
            children: <TemplateTab title="掉落表" endpoint="item-drop" />,
          },
        ]}
      />
    </div>
  );
}
