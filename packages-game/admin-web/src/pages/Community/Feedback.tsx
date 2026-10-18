import { useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface Feedback {
  id: number;
  playerId: string;
  type: string;
  content: string;
  status: string;
  createdAt?: string;
}

const TYPE_OPTIONS = [
  { label: 'Bug', value: 'bug' },
  { label: '建议', value: 'suggestion' },
  { label: '投诉', value: 'complaint' },
  { label: '其他', value: 'other' },
];

const STATUS_OPTIONS = [
  { label: '待处理', value: 'pending' },
  { label: '处理中', value: 'processing' },
  { label: '已解决', value: 'resolved' },
  { label: '已忽略', value: 'ignored' },
];

function statusTag(s: string) {
  const map: Record<string, string> = {
    pending: 'orange',
    processing: 'blue',
    resolved: 'green',
    ignored: 'default',
  };
  return <Tag color={map[s] || 'default'}>{s}</Tag>;
}

export default function FeedbackPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [type, setType] = useState<string | undefined>(undefined);

  const [handleOpen, setHandleOpen] = useState(false);
  const [current, setCurrent] = useState<Feedback | null>(null);
  const [form] = Form.useForm();

  const fetchList = (page: number, limit: number) => {
    const params: any = { page, limit };
    if (status) params.status = status;
    if (type) params.type = type;
    return client.get('/admin/v1/community/feedback/list', { params });
  };

  const openHandle = (record: Feedback) => {
    setCurrent(record);
    form.setFieldsValue({ status: record.status, remark: '' });
    setHandleOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (!current) return;
    try {
      await client.post(`/admin/v1/community/feedback/${current.id}/handle`, values);
      message.success('处理成功');
      setHandleOpen(false);
      setReloadKey((k) => k + 1);
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<Feedback> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '玩家', dataIndex: 'playerId', width: 160 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (t) => <Tag color="blue">{t}</Tag>,
    },
    {
      title: '内容',
      dataIndex: 'content',
      ellipsis: true,
      render: (c) => <span title={c}>{c}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s) => statusTag(s),
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, r) => (
        <Button size="small" type="primary" onClick={() => openHandle(r)}>
          处理
        </Button>
      ),
    },
  ];

  return (
    <>
      <AdminTable<Feedback>
        rowKey="id"
        title="玩家反馈"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey, status, type]}
        extra={
          <Space>
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 140 }}
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
            />
            <Select
              allowClear
              placeholder="类型"
              style={{ width: 140 }}
              value={type}
              onChange={setType}
              options={TYPE_OPTIONS}
            />
          </Space>
        }
      />

      <Modal
        open={handleOpen}
        onCancel={() => setHandleOpen(false)}
        onOk={handleSubmit}
        title={`处理反馈 #${current?.id}`}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="处理后状态" name="status" rules={[{ required: true }]}>
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
          <Form.Item label="处理备注" name="remark">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
