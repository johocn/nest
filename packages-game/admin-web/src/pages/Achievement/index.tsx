import { useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface AchievementRecord {
  id: number;
  name?: string;
  category?: string;
  type?: string;
  target?: string | number;
  condition?: any;
  reward?: any;
  isActive?: boolean;
  [k: string]: any;
}

const CATEGORY_OPTIONS = [
  { value: 'combat', label: '战斗' },
  { value: 'collection', label: '收集' },
  { value: 'social', label: '社交' },
  { value: 'exploration', label: '探索' },
  { value: 'system', label: '系统' },
];

const CATEGORY_COLOR: Record<string, string> = {
  combat: 'red',
  collection: 'purple',
  social: 'cyan',
  exploration: 'geekblue',
  system: 'default',
};

export default function AchievementPage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<AchievementRecord | null>(null);
  const [form] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchList = () => client.get('/admin/v1/achievement/template/list');

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, category: 'combat' });
    setCreateOpen(true);
  };

  const openEdit = (record: AchievementRecord) => {
    setCurrent(record);
    // condition / reward 可能是对象，需转成 JSON 字符串供 TextArea 编辑
    form.setFieldsValue({
      ...record,
      condition:
        typeof record.condition === 'string'
          ? record.condition
          : record.condition != null
            ? JSON.stringify(record.condition, null, 2)
            : '',
      reward:
        typeof record.reward === 'string'
          ? record.reward
          : record.reward != null
            ? JSON.stringify(record.reward, null, 2)
            : '',
    });
    setEditOpen(true);
  };

  const openDetail = (record: AchievementRecord) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const parseJSON = (v: any) => {
    if (v == null || v === '') return undefined;
    if (typeof v === 'object') return v;
    try {
      return JSON.parse(v);
    } catch {
      throw new Error('JSON 格式不正确');
    }
  };

  const submitForm = async (action: 'create' | 'update') => {
    const values = await form.validateFields();
    try {
      const payload = {
        ...values,
        condition: parseJSON(values.condition),
        reward: parseJSON(values.reward),
      };
      if (action === 'create') {
        await client.post('/admin/v1/achievement/template', payload);
        message.success('创建成功');
        setCreateOpen(false);
      } else {
        await client.put(`/admin/v1/achievement/template/${current?.id}`, payload);
        message.success('更新成功');
        setEditOpen(false);
      }
      triggerReload();
    } catch (e: any) {
      if (e?.message === 'JSON 格式不正确') {
        message.error(e.message);
      }
      // 其他错误拦截器已提示
    }
  };

  const columns: ColumnsType<AchievementRecord> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '名称', dataIndex: 'name' },
    {
      title: '分类',
      dataIndex: 'category',
      width: 120,
      render: (c: string) => <Tag color={CATEGORY_COLOR[c] || 'default'}>{c || '-'}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (t: string) => <Tag>{t || '-'}</Tag>,
    },
    { title: '目标值', dataIndex: 'target', width: 100 },
    {
      title: '条件',
      dataIndex: 'condition',
      render: (c: any) => {
        if (c == null) return '-';
        const str = typeof c === 'string' ? c : JSON.stringify(c);
        return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{str.slice(0, 60)}{str.length > 60 ? '…' : ''}</span>;
      },
    },
    {
      title: '奖励',
      dataIndex: 'reward',
      render: (r: any) => {
        if (r == null) return '-';
        const str = typeof r === 'string' ? r : JSON.stringify(r);
        return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{str.slice(0, 60)}{str.length > 60 ? '…' : ''}</span>;
      },
    },
    {
      title: '启用',
      dataIndex: 'isActive',
      width: 80,
      render: (v: boolean) =>
        v == null ? '-' : v ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: any, record: AchievementRecord) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
        </Space>
      ),
    },
  ];

  const FormFields = () => (
    <Form form={form} layout="vertical">
      <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
        <Input />
      </Form.Item>
      <Form.Item label="分类" name="category">
        <Select options={CATEGORY_OPTIONS} />
      </Form.Item>
      <Form.Item label="类型" name="type">
        <Input />
      </Form.Item>
      <Form.Item label="目标值" name="target">
        <Input />
      </Form.Item>
      <Form.Item
        label="条件 (JSON)"
        name="condition"
        tooltip="合法的 JSON 对象或字符串"
      >
        <Input.TextArea rows={5} placeholder='例如: {"kills": 100}' />
      </Form.Item>
      <Form.Item
        label="奖励 (JSON)"
        name="reward"
        tooltip="合法的 JSON 对象或字符串"
      >
        <Input.TextArea rows={5} placeholder='例如: {"coins": 1000}' />
      </Form.Item>
      <Form.Item label="启用" name="isActive" valuePropName="checked">
        <Switch />
      </Form.Item>
    </Form>
  );

  return (
    <>
      <AdminTable<AchievementRecord>
        rowKey="id"
        title="成就模板"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        defaultPageSize={20}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建模板
          </Button>
        }
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        title={`成就详情 #${current?.id}`}
      >
        {current && (
          <pre
            style={{
              maxHeight: 500,
              overflow: 'auto',
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 4,
              margin: 0,
              fontSize: 12,
            }}
          >
            {JSON.stringify(current, null, 2)}
          </pre>
        )}
      </Modal>

      <Modal
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        title="编辑成就"
        onOk={() => submitForm('update')}
        destroyOnClose
      >
        <FormFields />
      </Modal>

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建成就"
        onOk={() => submitForm('create')}
        destroyOnClose
      >
        <FormFields />
      </Modal>
    </>
  );
}
