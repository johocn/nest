import { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Collapse,
  Descriptions,
  Space,
  message,
  Spin,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import client from '../../api/client';

interface Span {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: string;
  status?: { code: string; message?: string };
  attributes?: Record<string, unknown>;
  events?: Array<{ name: string; time?: string; attributes?: Record<string, unknown> }>;
  duration: number; // ms
}

interface Trace {
  traceId: string;
  totalSpans: number;
  totalMs?: number;
  createdAt: string;
  spans: Span[];
}

function statusTag(status?: Span['status']) {
  if (!status || !status.code || status.code === 'OK' || status.code === 'UNSET') {
    return <Tag color="green">OK</Tag>;
  }
  return <Tag color="red">{status.code}{status.message ? `: ${status.message}` : ''}</Tag>;
}

function kindTag(kind?: string) {
  if (!kind) return null;
  const colorMap: Record<string, string> = {
    SERVER: 'blue',
    CLIENT: 'cyan',
    PRODUCER: 'purple',
    CONSUMER: 'magenta',
    INTERNAL: 'default',
  };
  return <Tag color={colorMap[kind.toUpperCase()] || 'default'}>{kind}</Tag>;
}

export default function Trace() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<Trace | undefined>();

  const fetchRecent = async () => {
    setLoading(true);
    try {
      const res = await client.get('/debug/v1/traces/recent', {
        params: { limit: 30 },
      });
      const list: Trace[] = res.data?.data?.traces || [];
      setTraces(list);
    } catch {
      // 拦截器已处理
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecent();
  }, []);

  const handleView = async (traceId: string) => {
    setSelectedId(traceId);
    setDetailLoading(true);
    try {
      const res = await client.get('/debug/v1/traces', {
        params: { traceId },
      });
      const t: Trace = res.data?.data;
      setDetail(t);
    } catch {
      setSelectedId(undefined);
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: ColumnsType<Trace> = [
    {
      title: 'Trace ID',
      dataIndex: 'traceId',
      key: 'traceId',
      width: 260,
      render: (id: string) => <code>{id}</code>,
    },
    {
      title: 'Span 数',
      dataIndex: 'totalSpans',
      key: 'totalSpans',
      width: 100,
    },
    {
      title: '总耗时 (ms)',
      key: 'totalMs',
      width: 130,
      render: (_: unknown, record) => {
        if (typeof record.totalMs === 'number') return record.totalMs.toFixed(2);
        // fallback: root span duration
        const root = record.spans?.find((s) => !s.parentSpanId);
        if (root) return root.duration.toFixed(2);
        return '-';
      },
    },
    {
      title: '根 Span',
      key: 'rootName',
      render: (_: unknown, record) => {
        const root = record.spans?.find((s) => !s.parentSpanId);
        return root ? <code>{root.name}</code> : '-';
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, record) => (
        <Button size="small" type="link" onClick={() => handleView(record.traceId)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>可观测性 — Trace</h2>

      <Card
        title="最近 Traces"
        extra={
          <Button onClick={fetchRecent} loading={loading}>
            刷新
          </Button>
        }
      >
        <Table<Trace>
          rowKey="traceId"
          columns={columns}
          dataSource={traces}
          loading={loading}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          scroll={{ x: 900 }}
        />
      </Card>

      {selectedId && (
        <Card
          title={`Trace 详情 — ${selectedId}`}
          style={{ marginTop: 16 }}
          extra={
            <Button size="small" onClick={() => setSelectedId(undefined)}>
              关闭
            </Button>
          }
        >
          <Spin spinning={detailLoading}>
            {detail && (
              <Collapse
                items={detail.spans.map((span) => ({
                  key: span.spanId,
                  label: (
                    <Space>
                      {statusTag(span.status)}
                      <code>{span.name}</code>
                      <span style={{ color: '#999' }}>
                        {span.duration.toFixed(2)} ms
                      </span>
                      {kindTag(span.kind)}
                    </Space>
                  ),
                  children: (
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="Span ID">
                        <code>{span.spanId}</code>
                      </Descriptions.Item>
                      {span.parentSpanId && (
                        <Descriptions.Item label="Parent Span ID">
                          <code>{span.parentSpanId}</code>
                        </Descriptions.Item>
                      )}
                      {span.attributes && Object.keys(span.attributes).length > 0 && (
                        <Descriptions.Item label="Attributes">
                          <pre
                            style={{
                              background: '#f5f5f5',
                              padding: 8,
                              borderRadius: 4,
                              margin: 0,
                              fontSize: 12,
                              maxHeight: 240,
                              overflow: 'auto',
                            }}
                          >
                            {JSON.stringify(span.attributes, null, 2)}
                          </pre>
                        </Descriptions.Item>
                      )}
                      {span.events && span.events.length > 0 && (
                        <Descriptions.Item label="Events">
                          <Space direction="vertical" style={{ width: '100%' }}>
                            {span.events.map((ev, idx) => (
                              <div
                                key={idx}
                                style={{
                                  background: '#fafafa',
                                  padding: 8,
                                  borderRadius: 4,
                                  border: '1px solid #eee',
                                }}
                              >
                                <strong>{ev.name}</strong>
                                {ev.time && (
                                  <span style={{ color: '#999', marginLeft: 8 }}>
                                    {ev.time}
                                  </span>
                                )}
                                {ev.attributes && (
                                  <pre
                                    style={{
                                      marginTop: 4,
                                      fontSize: 11,
                                      color: '#666',
                                      margin: '4px 0 0',
                                    }}
                                  >
                                    {JSON.stringify(ev.attributes, null, 2)}
                                  </pre>
                                )}
                              </div>
                            ))}
                          </Space>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ),
                }))}
              />
            )}
            {!detailLoading && !detail && (
              <span style={{ color: '#999' }}>未找到 Trace 详情</span>
            )}
          </Spin>
        </Card>
      )}
    </div>
  );
}
