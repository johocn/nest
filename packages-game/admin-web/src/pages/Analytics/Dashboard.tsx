import { useEffect, useState } from 'react';
import { Card, Col, Empty, Row, Spin, Statistic, Tag } from 'antd';
import client from '../../api/client';

interface DashboardResponse {
  dau: number;
  behaviorStats: any[];
  generatedAt?: string;
  // 兼容字段，后端暂不返回时 fallback 用
  wau?: number;
  mau?: number;
  newUsers?: number;
  retentionDay1?: number | null;
  retentionDay7?: number | null;
  arpu?: number | null;
  revenue?: number | null;
}

function formatGeneratedAt(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [behavior, setBehavior] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client
      .get('/admin/v1/analytics/dashboard')
      .then((dashRes) => {
        const env = dashRes?.data ?? dashRes;
        const dashData = env?.code === 0 ? env.data : env;
        setDashboard(dashData || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!dashboard && !behavior) {
    return <Empty description="暂无数据" />;
  }

  const metrics = (dashboard || {}) as Partial<DashboardResponse>;
  const generatedAt = formatGeneratedAt(metrics.generatedAt);

  const cards: Array<{
    title: string;
    value: number | string;
    suffix?: string;
    fallback?: string;
  }> = [
    { title: 'DAU', value: metrics.dau ?? 0, suffix: '日活跃' },
    { title: 'WAU', value: metrics.wau ?? 0, suffix: '周活跃' },
    { title: 'MAU', value: metrics.mau ?? 0, suffix: '月活跃' },
    { title: '新增用户', value: metrics.newUsers ?? 0, suffix: '今日' },
    {
      title: '次日留存',
      value: metrics.retentionDay1 ?? 0,
      suffix: metrics.retentionDay1 != null ? '%' : undefined,
    },
    {
      title: '7 日留存',
      value: metrics.retentionDay7 ?? 0,
      suffix: metrics.retentionDay7 != null ? '%' : undefined,
    },
    {
      title: 'ARPU',
      value: metrics.arpu ?? 0,
      suffix: metrics.arpu != null ? '元' : undefined,
    },
    {
      title: '收入',
      value: metrics.revenue ?? 0,
      suffix: metrics.revenue != null ? '元' : undefined,
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <span style={{ fontSize: 20, fontWeight: 600 }}>运营概览</span>
        </Col>
        <Col>
          <Tag color="blue">数据生成时间：{generatedAt}</Tag>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col xs={24} sm={12} md={8} lg={6} key={c.title}>
            <Card>
              <Statistic
                title={c.title}
                value={c.value}
                suffix={c.suffix}
                valueStyle={{ fontSize: 28 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {behavior && (
        <Card title="行为统计" style={{ marginTop: 16 }}>
          <pre
            style={{
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 4,
              maxHeight: 400,
              overflow: 'auto',
              margin: 0,
            }}
          >
            {typeof behavior === 'string' ? behavior : JSON.stringify(behavior, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}
