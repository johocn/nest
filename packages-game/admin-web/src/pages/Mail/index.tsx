import { useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface MailRecord {
  id: number;
  title?: string;
  type?: string;
  sender?: string;
  recipient?: string;
  status?: string;
  sentAt?: string;
  [k: string]: any;
}

const TYPE_OPTIONS = [
  { value: 'system', label: '系统邮件' },
  { value: 'activity', label: '活动邮件' },
  { value: 'compensation', label: '补偿邮件' },
  { value: 'gm', label: 'GM 邮件' },
];

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending: { color: 'orange', label: '待发送' },
  sent: { color: 'green', label: '已发送' },
  failed: { color: 'red', label: '发送失败' },
};

const TARGET_TYPE_OPTIONS = [
  { value: 'all', label: '全服玩家' },
  { value: 'level', label: '按等级' },
  { value: 'vip', label: '按 VIP 等级' },
  { value: 'playerIds', label: '指定玩家 ID' },
];

export default function MailPage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<MailRecord | null>(null);

  const [singleForm] = Form.useForm();
  const [batchForm] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchList = () => client.get('/admin/v1/mail/list');

  const openSend = () => {
    singleForm.resetFields();
    batchForm.resetFields();
    singleForm.setFieldsValue({ type: 'system' });
    batchForm.setFieldsValue({ type: 'system', targetType: 'all' });
    setSendOpen(true);
  };

  const openDetail = (record: MailRecord) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const handleSendSingle = async () => {
    const values = await singleForm.validateFields();
    try {
      await client.post('/admin/v1/mail/send', values);
      message.success('单封邮件发送成功');
      setSendOpen(false);
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const handleSendBatch = async () => {
    const values = await batchForm.validateFields();
    try {
      await client.post('/admin/v1/mail/batch-send', values);
      message.success('批量邮件发送成功');
      setSendOpen(false);
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<MailRecord> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '标题', dataIndex: 'title' },
    {
      title: '类型/发送者',
      key: 'type_sender',
      width: 180,
      render: (_: any, r: MailRecord) => (
        <Space direction="vertical" size={0}>
          {r.type && <Tag color="blue">{r.type}</Tag>}
          {r.sender && <span style={{ fontSize: 12, color: '#888' }}>{r.sender}</span>}
        </Space>
      ),
    },
    { title: '接收者', dataIndex: 'recipient' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (s: string) => {
        const m = STATUS_MAP[s];
        return m ? <Tag color={m.color}>{m.label}</Tag> : <Tag>{s || '-'}</Tag>;
      },
    },
    { title: '发送时间', dataIndex: 'sentAt', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: MailRecord) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <AdminTable<MailRecord>
        rowKey="id"
        title="邮件管理"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        defaultPageSize={20}
        extra={
          <Button type="primary" onClick={openSend}>
            发送邮件
          </Button>
        }
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        title={`邮件详情 #${current?.id}`}
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
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        title="发送邮件"
        footer={null}
        destroyOnClose
        width={640}
      >
        <Tabs
          items={[
            {
              key: 'single',
              label: '单封发送',
              children: (
                <Form form={singleForm} layout="vertical">
                  <Form.Item
                    label="玩家 ID"
                    name="playerId"
                    rules={[{ required: true, message: '请输入玩家 ID' }]}
                  >
                    <InputNumber min={1} style={{ width: '100%' }} placeholder="目标玩家 ID" />
                  </Form.Item>
                  <Form.Item
                    label="标题"
                    name="title"
                    rules={[{ required: true, message: '请输入邮件标题' }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item label="类型" name="type">
                    <Select options={TYPE_OPTIONS} />
                  </Form.Item>
                  <Form.Item
                    label="内容"
                    name="content"
                    rules={[{ required: true, message: '请输入邮件内容' }]}
                  >
                    <Input.TextArea rows={5} />
                  </Form.Item>
                  <div style={{ textAlign: 'right' }}>
                    <Button type="primary" onClick={handleSendSingle}>
                      立即发送
                    </Button>
                  </div>
                </Form>
              ),
            },
            {
              key: 'batch',
              label: '批量发送',
              children: (
                <Form form={batchForm} layout="vertical">
                  <Form.Item
                    label="发送范围"
                    name="targetType"
                    rules={[{ required: true, message: '请选择发送范围' }]}
                  >
                    <Select options={TARGET_TYPE_OPTIONS} />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.targetType !== cur.targetType}>
                    {({ getFieldValue }) => {
                      const tt = getFieldValue('targetType');
                      if (tt === 'level') {
                        return (
                          <Form.Item label="目标等级" name="targetValue">
                            <Input placeholder="如 10-50，或具体等级" />
                          </Form.Item>
                        );
                      }
                      if (tt === 'vip') {
                        return (
                          <Form.Item label="目标 VIP" name="targetValue">
                            <Input placeholder="如 VIP3 以上" />
                          </Form.Item>
                        );
                      }
                      if (tt === 'playerIds') {
                        return (
                          <Form.Item label="玩家 ID 列表" name="targetValue">
                            <Input.TextArea rows={2} placeholder="逗号分隔的玩家 ID" />
                          </Form.Item>
                        );
                      }
                      return null;
                    }}
                  </Form.Item>
                  <Form.Item
                    label="标题"
                    name="title"
                    rules={[{ required: true, message: '请输入邮件标题' }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item label="类型" name="type">
                    <Select options={TYPE_OPTIONS} />
                  </Form.Item>
                  <Form.Item
                    label="内容"
                    name="content"
                    rules={[{ required: true, message: '请输入邮件内容' }]}
                  >
                    <Input.TextArea rows={5} />
                  </Form.Item>
                  <div style={{ textAlign: 'right' }}>
                    <Button type="primary" onClick={handleSendBatch}>
                      立即发送
                    </Button>
                  </div>
                </Form>
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}
