import { useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface Report {
  id: number;
  reporterId: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt?: string;
}

const STATUS_OPTIONS = [
  { label: '待处理', value: 'pending' },
  { label: '调查中', value: 'investigating' },
  { label: '已处罚', value: 'punished' },
  { label: '已驳回', value: 'dismissed' },
];

function statusTag(s: string) {
  const map: Record<string, string> = {
    pending: 'orange',
    investigating: 'blue',
    punished: 'red',
    dismissed: 'default',
  };
  return <Tag color={map[s] || 'default'}>{s}</Tag>;
}

export default function ReportsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<string | undefined>(undefined);

  const [handleOpen, setHandleOpen] = useState(false);
  const [current, setCurrent] = useState<Report | null>(null);
  const [form] = Form.useForm();

  const fetchList = (page: number, limit: number) => {
    const params: any = { page, limit };
    if (status) params.status = status;
    return client.get('/admin/v1/community/reports', { params });
  };

  const openHandle = (record: Report) => {
    setCurrent(record);
    form.setFieldsValue({ status: record.status, remark: '' });
    setHandleOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (!current) return;
    try {
      await client.post(`/admin/v1/community/reports/${current.id}/handle`, values);
      message.success('处理成功');
      setHandleOpen(false);
      setReloadKey((k) => k + 1);
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<Report> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '举报人', dataIndex: 'reporterId', width: 140 },
    { title: '被举报目标', dataIndex: 'targetId', width: 140 },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
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
      <AdminTable<Report>
        rowKey="id"
        title="举报处理"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey, status]}
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
          </Space>
        }
      />

      <Modal
        open={handleOpen}
        onCancel={() => setHandleOpen(false)}
        onOk={handleSubmit}
        title={`处理举报 #${current?.id}`}
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
