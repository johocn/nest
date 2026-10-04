import { useEffect, useState } from 'react';
import { Button, Input, Modal, Row, Space, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';
import { fmtValue, truncate } from '../../utils/format';

interface AdminLogRecord {
  id: number;
  adminId: string | number;
  targetPlayerId?: string | number | null;
  operation: string;
  changeBefore?: any;
  changeAfter?: any;
  createdAt: string;
}

export default function AdminLogPage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [current, setCurrent] = useState<AdminLogRecord | null>(null);
  const [operationFilter, setOperationFilter] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  const triggerReload = () => setReloadKey((k) => k + 1);

  // 拉在线人数 (独立 fetch, 页面加载一次)
  useEffect(() => {
    client
      .get('/admin/v1/ops/online')
      .then((res: any) => {
        const env = res?.data ?? res;
        const body = env?.code === 0 ? env.data : env;
        setOnlineCount(body?.count ?? 0);
      })
      .catch(() => setOnlineCount(null));
  }, []);

  const fetchList = (page: number, limit: number) => {
    const params: Record<string, any> = { page, limit };
    if (operationFilter) params.operation = operationFilter;
    return client.get('/admin/v1/ops/gm-log/list', { params });
  };

  const openDetail = (record: AdminLogRecord) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const columns: ColumnsType<AdminLogRecord> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '操作人', dataIndex: 'adminId', width: 100 },
    { title: '操作', dataIndex: 'operation', width: 160, render: (op: string) => <Tag color="purple">{op}</Tag> },
    {
      title: '目标玩家',
      dataIndex: 'targetPlayerId',
      width: 140,
      render: (v: any) => (v == null || v === '' ? '-' : v),
    },
    {
      title: '变更前',
      dataIndex: 'changeBefore',
      ellipsis: true,
      render: (v: any) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{truncate(fmtValue(v), 200) || '-'}</span>,
    },
    {
      title: '变更后',
      dataIndex: 'changeAfter',
      ellipsis: true,
      render: (v: any) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{truncate(fmtValue(v), 200) || '-'}</span>,
    },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, record: AdminLogRecord) => (
        <Button size="small" onClick={() => openDetail(record)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Space>
          <span style={{ fontSize: 20, fontWeight: 600 }}>操作日志 (GM Log)</span>
          {onlineCount != null && (
            <Tag color="blue">在线人数: {onlineCount}</Tag>
          )}
        </Space>
      </Row>

      <AdminTable<AdminLogRecord>
        rowKey="id"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey, operationFilter]}
        extra={
          <Space>
            <Input
              placeholder="搜索 operation"
              value={operationFilter}
              onChange={(e) => setOperationFilter(e.target.value)}
              style={{ width: 200 }}
              allowClear
            />
            <Button icon={<ReloadOutlined />} onClick={triggerReload}>
              刷新
            </Button>
          </Space>
        }
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={800}
        title={`操作日志 #${current?.id}`}
      >
        {current && (
          <div>
            <div style={{ marginBottom: 8 }}>
              操作: <Tag color="purple">{current.operation}</Tag>
              {'  '}
              操作人: <b>{current.adminId}</b>
              {'  '}
              目标玩家: <b>{current.targetPlayerId ?? '-'}</b>
              {'  '}
              时间: <span style={{ color: '#888' }}>{current.createdAt}</span>
            </div>
            <Row gutter={12}>
              <div style={{ flex: 1, minWidth: 340 }}>
                <div style={{ marginBottom: 6, fontWeight: 600 }}>变更前</div>
                <pre
                  style={{
                    maxHeight: 420,
                    overflow: 'auto',
                    background: '#fff1f0',
                    border: '1px solid #ffa39e',
                    padding: 12,
                    borderRadius: 4,
                    margin: 0,
                    fontSize: 12,
                  }}
                >
                  {current.changeBefore ? JSON.stringify(current.changeBefore, null, 2) : '(无)'}
                </pre>
              </div>
              <div style={{ flex: 1, minWidth: 340 }}>
                <div style={{ marginBottom: 6, fontWeight: 600 }}>变更后</div>
                <pre
                  style={{
                    maxHeight: 420,
                    overflow: 'auto',
                    background: '#f6ffed',
                    border: '1px solid #b7eb8f',
                    padding: 12,
                    borderRadius: 4,
                    margin: 0,
                    fontSize: 12,
                  }}
                >
                  {current.changeAfter ? JSON.stringify(current.changeAfter, null, 2) : '(无)'}
                </pre>
              </div>
            </Row>
          </div>
        )}
      </Modal>
    </>
  );
}
