import { useEffect, useState } from 'react';
import {
  Button,
  Empty,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import client from '../../api/client';

interface ReconcileRecord {
  id: number;
  statDate: string;
  reconcileType: string;
  checked: boolean;
  mismatch: number;
  createdAt: string;
  detailJson?: any;
}

const TYPE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'TRADE', label: 'TRADE' },
  { value: 'AUCTION', label: 'AUCTION' },
  { value: 'ESCROW', label: 'ESCROW' },
  { value: 'BOUNTY', label: 'BOUNTY' },
  { value: 'CRAFT', label: 'CRAFT' },
];

export default function ReconcilePage() {
  const [data, setData] = useState<ReconcileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [current, setCurrent] = useState<ReconcileRecord | null>(null);
  const [runLoading, setRunLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (typeFilter) params.type = typeFilter;
      const res = await client.get('/admin/v1/reconcile/results', { params });
      const env = res?.data ?? res;
      const body = env?.code === 0 ? env.data : env;
      const list: ReconcileRecord[] = body?.list ?? body?.items ?? (Array.isArray(body) ? body : []);
      setData(list);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  const handleRun = async () => {
    setRunLoading(true);
    try {
      await client.post('/admin/v1/reconcile/run');
      message.success('对账已触发');
      await load();
    } catch {
      // 拦截器已提示
    } finally {
      setRunLoading(false);
    }
  };

  const openDetail = async (record: ReconcileRecord) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const columns: ColumnsType<ReconcileRecord> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '对账日期', dataIndex: 'statDate', width: 140 },
    {
      title: '类型',
      dataIndex: 'reconcileType',
      width: 120,
      render: (t: string) => <Tag color="blue">{t}</Tag>,
    },
    {
      title: '已检查',
      dataIndex: 'checked',
      width: 100,
      render: (v: boolean) =>
        v ? <Tag color="green">已完成</Tag> : <Tag color="orange">进行中</Tag>,
    },
    {
      title: '差异条数',
      dataIndex: 'mismatch',
      width: 120,
      render: (v: number) =>
        v > 0 ? <span style={{ color: 'red', fontWeight: 600 }}>{v}</span> : <span>0</span>,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, record: ReconcileRecord) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 20, fontWeight: 600 }}>对账结果</span>
        <Space>
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            options={TYPE_OPTIONS}
            style={{ width: 160 }}
          />
          <Popconfirm
            title="确认手动触发对账？"
            onConfirm={handleRun}
            okText="确认"
            cancelText="取消"
          >
            <Button danger loading={runLoading}>
              手动触发对账
            </Button>
          </Popconfirm>
        </Space>
      </Row>

      <Table<ReconcileRecord>
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        locale={{ emptyText: <Empty description="暂无对账结果" /> }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={800}
        title={`对账详情 #${current?.id}`}
      >
        {current && (
          <>
            <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
              <div>对账日期: <b>{current.statDate}</b></div>
              <div style={{ marginLeft: 24 }}>类型: <Tag color="blue">{current.reconcileType}</Tag></div>
              <div style={{ marginLeft: 24 }}>
                状态: {current.checked ? <Tag color="green">已完成</Tag> : <Tag color="orange">进行中</Tag>}
              </div>
              <div style={{ marginLeft: 24 }}>
                差异: {current.mismatch > 0 ? <span style={{ color: 'red', fontWeight: 600 }}>{current.mismatch}</span> : '0'}
              </div>
            </Row>
            <Spin spinning={loading}>
              <pre
                style={{
                  maxHeight: 480,
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
            </Spin>
          </>
        )}
      </Modal>
    </div>
  );
}
