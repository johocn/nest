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

interface NoticeRecord {
  id: number;
  title?: string;
  type?: string;
  scope?: string;
  priority?: string;
  isActive?: boolean;
  publishedAt?: string;
  [k: string]: any;
}

const TYPE_OPTIONS = [
  { value: 'announcement', label: '公告' },
  { value: 'maintenance', label: '维护' },
  { value: 'activity', label: '活动' },
];

const SCOPE_OPTIONS = [
  { value: 'global', label: '全服' },
  { value: 'server', label: '按服务器' },
  { value: 'channel', label: '按渠道' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'normal', label: '普通' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
];

const PRIORITY_COLOR: Record<string, string> = {
  low: 'default',
  normal: 'blue',
  high: 'orange',
  urgent: 'red',
};

const TYPE_COLOR: Record<string, string> = {
  announcement: 'blue',
  maintenance: 'gold',
  activity: 'green',
};

export default function NoticePage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<NoticeRecord | null>(null);
  const [form] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchList = () => client.get('/admin/v1/notice/list');

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({
      isActive: true,
      type: 'announcement',
      scope: 'global',
      priority: 'normal',
    });
    setCreateOpen(true);
  };

  const openEdit = (record: NoticeRecord) => {
    setCurrent(record);
    form.setFieldsValue(record);
    setEditOpen(true);
  };

  const openDetail = async (record: NoticeRecord) => {
    try {
      const res = await client.get(`/admin/v1/notice/${record.id}`);
      const envelope = res?.data ?? res;
      const detail = envelope?.code === 0 ? envelope.data : envelope;
      setCurrent(detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : record);
    } catch {
      setCurrent(record);
    }
    setDetailOpen(true);
  };

  const submitForm = async (action: 'create' | 'update') => {
    const values = await form.validateFields();
    try {
      if (action === 'create') {
        await client.post('/admin/v1/notice', values);
        message.success('创建成功');
        setCreateOpen(false);
      } else {
        await client.put(`/admin/v1/notice/${current?.id}`, values);
        message.success('更新成功');
        setEditOpen(false);
      }
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<NoticeRecord> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '标题', dataIndex: 'title' },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (t: string) => <Tag color={TYPE_COLOR[t] || 'default'}>{t || '-'}</Tag>,
    },
    {
      title: '范围',
      dataIndex: 'scope',
      width: 100,
      render: (s: string) => <Tag>{s || '-'}</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 100,
      render: (p: string) => <Tag color={PRIORITY_COLOR[p] || 'default'}>{p || '-'}</Tag>,
    },
    {
      title: '启用',
      dataIndex: 'isActive',
      width: 80,
      render: (v: boolean) =>
        v == null ? '-' : v ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>,
    },
    { title: '发布时间', dataIndex: 'publishedAt', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: NoticeRecord) => (
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
      <Form.Item label="标题" name="title" rules={[{ required: true, message: '请输入标题' }]}>
        <Input />
      </Form.Item>
      <Form.Item label="类型" name="type">
        <Select options={TYPE_OPTIONS} />
      </Form.Item>
      <Form.Item label="范围" name="scope">
        <Select options={SCOPE_OPTIONS} />
      </Form.Item>
      <Form.Item label="优先级" name="priority">
        <Select options={PRIORITY_OPTIONS} />
      </Form.Item>
      <Form.Item label="启用" name="isActive" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="内容" name="content">
        <Input.TextArea rows={6} />
      </Form.Item>
    </Form>
  );

  return (
    <>
      <AdminTable<NoticeRecord>
        rowKey="id"
        title="公告管理"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        defaultPageSize={20}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建公告
          </Button>
        }
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        title={`公告详情 #${current?.id}`}
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
        title="编辑公告"
        onOk={() => submitForm('update')}
        destroyOnClose
      >
        <FormFields />
      </Modal>

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建公告"
        onOk={() => submitForm('create')}
        destroyOnClose
      >
        <FormFields />
      </Modal>
    </>
  );
}
