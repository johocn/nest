import { useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

// ============ Tab 1: 聊天日志 ============
interface ChatLog {
  id: number | string;
  channelType?: string;
  sender?: string;
  target?: string;
  message?: string;
  sentAt?: string;
  [k: string]: any;
}

function ChatLogTab({ reloadKey }: { reloadKey: number }) {
  const truncate = (s?: string, n = 60) => {
    if (!s) return '-';
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  const columns: ColumnsType<ChatLog> = [
    { title: 'ID', dataIndex: 'id', width: 90 },
    {
      title: '渠道',
      dataIndex: 'channelType',
      width: 110,
      render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : '-'),
    },
    { title: '发送者', dataIndex: 'sender', width: 140 },
    { title: '接收方', dataIndex: 'target', width: 140 },
    {
      title: '消息',
      dataIndex: 'message',
      ellipsis: true,
      render: (v: string) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{truncate(v, 80)}</span>
      ),
    },
    { title: '发送时间', dataIndex: 'sentAt', width: 180 },
  ];

  return (
    <AdminTable<ChatLog>
      rowKey="id"
      title="聊天日志"
      columns={columns}
      fetchFn={() => client.get('/admin/v1/chat/log/list')}
      deps={[reloadKey]}
      defaultPageSize={20}
    />
  );
}

// ============ Tab 2: 客服管理 ============
interface SupportTicket {
  id: number | string;
  category?: string;
  question?: string;
  status?: 'open' | 'replied' | 'closed' | string;
  createdAt?: string;
  [k: string]: any;
}

const STATUS_COLOR_MAP: Record<string, string> = {
  open: 'orange',
  replied: 'blue',
  closed: 'default',
};

const STATUS_LABEL_MAP: Record<string, string> = {
  open: '待回复',
  replied: '已回复',
  closed: '已关闭',
};

function SupportTab({
  reloadKey,
  triggerReload,
}: {
  reloadKey: number;
  triggerReload: () => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [current, setCurrent] = useState<SupportTicket | null>(null);
  const [replyText, setReplyText] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);

  const openReply = (record: SupportTicket) => {
    setCurrent(record);
    setReplyText('');
    setReplyOpen(true);
  };

  const openDetail = (record: SupportTicket) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const handleReply = async () => {
    if (!current) return;
    if (!replyText.trim()) {
      message.error('回复内容不能为空');
      return;
    }
    try {
      await client.post(`/admin/v1/chat/support/${current.id}/reply`, {
        reply: replyText.trim(),
      });
      message.success('回复成功');
      setReplyOpen(false);
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<SupportTicket> = [
    { title: 'ID', dataIndex: 'id', width: 90 },
    {
      title: '分类',
      dataIndex: 'category',
      width: 110,
      render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
    },
    {
      title: '问题',
      dataIndex: 'question',
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => {
        if (!s) return '-';
        const color = STATUS_COLOR_MAP[s] ?? 'default';
        const label = STATUS_LABEL_MAP[s] ?? s;
        return <Tag color={color}>{label}</Tag>;
      },
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: SupportTicket) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          <Button size="small" type="primary" onClick={() => openReply(record)}>
            回复
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <AdminTable<SupportTicket>
        rowKey="id"
        title="客服工单"
        columns={columns}
        fetchFn={() => client.get('/admin/v1/chat/support/list')}
        deps={[reloadKey]}
        defaultPageSize={10}
      />

      <Modal
        open={replyOpen}
        onCancel={() => setReplyOpen(false)}
        title={`回复工单 #${current?.id}`}
        onOk={handleReply}
        width={520}
        destroyOnClose
      >
        {current?.question && (
          <div
            style={{
              background: '#f5f5f5',
              padding: 10,
              borderRadius: 4,
              marginBottom: 12,
              fontSize: 12,
            }}
          >
            <div style={{ color: '#999', marginBottom: 4 }}>用户问题：</div>
            {current.question}
          </div>
        )}
        <Form layout="vertical">
          <Form.Item label="回复内容" required>
            <Input.TextArea
              rows={5}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="请输入回复内容…"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={640}
        title={`工单详情 #${current?.id}`}
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
    </>
  );
}

// ============ Tab 2: 幸运星抽奖 ============
interface LuckyDrawForm {
  poolId?: string | number;
  count: number;
}

function LuckyStarPanel() {
  const [drawOpen, setDrawOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<LuckyDrawForm>();

  const openDraw = () => {
    form.resetFields();
    form.setFieldsValue({ count: 10 });
    setDrawOpen(true);
  };

  const handleDraw = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const r = await client.post('/admin/v1/chat/lucky-star/draw', values);
      const result = r.data?.data ?? r.data;
      message.success('抽奖执行成功');
      Modal.info({
        title: '幸运星抽奖结果',
        width: 640,
        content: (
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
            {JSON.stringify(result, null, 2)}
          </pre>
        ),
      });
      setDrawOpen(false);
    } catch {
      // 拦截器已提示
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="幸运星抽奖 (Lucky Star)"
      extra={
        <Button type="primary" onClick={openDraw}>
          执行幸运星抽奖
        </Button>
      }
      style={{ marginTop: 16 }}
    >
      <p style={{ color: '#666', margin: 0 }}>
        点击右上角按钮触发抽奖。可指定奖池 (poolId) 与抽取数量 (count，默认 10)。
      </p>

      <Modal
        open={drawOpen}
        onCancel={() => setDrawOpen(false)}
        title="执行幸运星抽奖"
        onOk={handleDraw}
        confirmLoading={loading}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="奖池 ID (可选)" name="poolId">
            <Input placeholder="如未指定将使用默认奖池" />
          </Form.Item>
          <Form.Item
            label="抽取数量"
            name="count"
            rules={[{ required: true, message: '请输入数量' }]}
          >
            <InputNumber min={1} max={1000} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

// ============ 主组件 ============
export default function ChatPage() {
  // 共享 reloadKey，两个 tab 和抽奖面板都可触发刷新
  const [reloadKey, setReloadKey] = useState(0);
  const triggerReload = () => setReloadKey((k) => k + 1);

  return (
    <>
      <h2 style={{ marginBottom: 16 }}>聊天 GM 工具</h2>
      <Tabs
        items={[
          {
            key: 'log',
            label: '聊天日志',
            children: <ChatLogTab reloadKey={reloadKey} />,
          },
          {
            key: 'support',
            label: '客服/抽奖',
            children: (
              <>
                <SupportTab reloadKey={reloadKey} triggerReload={triggerReload} />
                <LuckyStarPanel />
              </>
            ),
          },
        ]}
      />
    </>
  );
}
