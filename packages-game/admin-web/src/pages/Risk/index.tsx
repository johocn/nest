import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Modal, Row, Space, Statistic, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface RiskDashboard {
  top: any[];
  pending: number;
}

interface RiskCase {
  id: number | string;
  playerId?: number | string;
  type?: string;
  severity?: string;
  status?: string;
  createdAt?: string;
}

export default function RiskPage() {
  const [dashboard, setDashboard] = useState<RiskDashboard | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [dashLoading, setDashLoading] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [current, setCurrent] = useState<any>(null);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      const res = await client.get('/admin/v1/risk/dashboard');
      const envelope = res?.data ?? res;
      const body = envelope?.code === 0 ? envelope.data : envelope;
      setDashboard({
        top: Array.isArray(body?.top) ? body.top : [],
        pending: typeof body?.pending === 'number' ? body.pending : 0,
      });
    } catch (e: any) {
      setDashError(e?.message || '加载失败');
      setDashboard({ top: [], pending: 0 });
    } finally {
      setDashLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const caseColumns = useMemo<ColumnsType<RiskCase>>(
    () => [
      { title: 'ID', dataIndex: 'id', width: 80 },
      { title: '玩家 ID', dataIndex: 'playerId', width: 100 },
      { title: '类型', dataIndex: 'type', width: 120 },
      { title: '严重程度', dataIndex: 'severity', width: 100 },
      { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => v ? <Tag>{v}</Tag> : '-' },
      { title: '创建时间', dataIndex: 'createdAt', width: 180 },
      {
        title: '操作',
        key: 'action',
        width: 180,
        render: (_: any, r) => (
          <Space>
            <Button
              size="small"
              onClick={() => {
                setCurrent(r);
                setDetailOpen(true);
              }}
            >
              详情
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                message.info('处理功能待接入后端');
              }}
            >
              处理
            </Button>
          </Space>
        ),
      },
    ],
    [],
  );

  const topColumns = useMemo<ColumnsType<any>>(
    () => [
      { title: '类型/类别', dataIndex: 'type', key: 'type' },
      { title: '数量', dataIndex: 'count', key: 'count', width: 120 },
      { title: '玩家', dataIndex: 'playerId', key: 'playerId', width: 120 },
    ],
    [],
  );

  const caseFetch = () => client.get('/admin/v1/risk/cases');

  const tabItems = [
    {
      key: 'dashboard',
      label: '风控看板',
      children: (
        <div>
          {dashError && (
            <Alert
              type="error"
              message={`加载看板失败: ${dashError}`}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Row gutter={[16, 16]}>
            <Col span={24}>
              <Card
                loading={dashLoading}
                title="待处理案件"
                extra={<Button onClick={loadDashboard}>刷新</Button>}
              >
                <Statistic
                  title="待处理"
                  value={dashboard?.pending ?? 0}
                  valueStyle={{ color: '#cf1322', fontSize: 32 }}
                />
              </Card>
            </Col>

            <Col span={24}>
              <Card
                title="Top 案件类型"
                loading={dashLoading}
              >
                {dashboard?.top && dashboard.top.length > 0 ? (
                  <Table
                    size="small"
                    rowKey={(r: any, i) => r.id ?? `${i}`}
                    columns={topColumns}
                    dataSource={dashboard.top}
                    pagination={false}
                  />
                ) : (
                  <Empty description="暂无数据" />
                )}
              </Card>
            </Col>
          </Row>
        </div>
      ),
    },
    {
      key: 'cases',
      label: '风控案件',
      children: (
        <AdminTable<RiskCase>
          rowKey="id"
          title="风控案件"
          columns={caseColumns}
          fetchFn={caseFetch}
          defaultPageSize={20}
        />
      ),
    },
  ];

  return (
    <>
      <Tabs items={tabItems} />

      <Modal
        open={detailOpen}
        title="案件详情"
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={600}
      >
        <pre
          style={{
            background: '#f5f5f5',
            padding: 12,
            borderRadius: 4,
            maxHeight: 400,
            overflow: 'auto',
            fontSize: 12,
          }}
        >
          {JSON.stringify(current, null, 2)}
        </pre>
      </Modal>
    </>
  );
}
