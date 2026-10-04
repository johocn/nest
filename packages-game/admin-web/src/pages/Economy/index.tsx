import { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Row, Space, Spin, Statistic, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import client from '../../api/client';

interface EconomyDashboardResponse {
  generatedAt?: string;
  health?: boolean;

  /** 通胀相关 */
  monthlyInflationRate?: number | null;
  quarterlyInflationRate?: number | null;
  annualInflationRate?: number | null;
  cpi?: number | null;

  /** 资产总量与分布 */
  totalAssets?: string | number;
  goldStock?: string | number;
  goldInflow30d?: string | number;
  goldOutflow30d?: string | number;
  velocity30d?: number | null;

  /** 冻结 & 回收 */
  frozenAssets?: string | number;
  frozenPlayerCount?: number;
  recoveredAmount30d?: string | number;
  recoveredCount30d?: number;

  /** 资产分布 */
  assetDistribution?: Record<string, any>;
  currencyDistribution?: Record<string, any>;

  /** 可选的异常提示 */
  alerts?: string[];
}

function fmtNumber(v: any): string {
  if (v == null) return '0';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

function fmtRate(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(2)}%`;
}

function fmtGeneratedAt(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export default function EconomyDashboardPage() {
  const [data, setData] = useState<EconomyDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await client.get('/admin/v1/economy/dashboard');
      const env = res?.data ?? res;
      const body = env?.code === 0 ? env.data : env;
      setData(body || null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!data) {
    return (
      <Empty
        description="经济看板暂无数据"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        <Button type="primary" onClick={load} icon={<ReloadOutlined />}>
          重新加载
        </Button>
      </Empty>
    );
  }

  const d = data;
  const generatedAt = fmtGeneratedAt(d.generatedAt);
  const healthTag =
    d.health === true ? (
      <Tag color="green">● 健康</Tag>
    ) : d.health === false ? (
      <Tag color="red">● 异常</Tag>
    ) : (
      <Tag color="default">● 未知</Tag>
    );

  const assetEntries = Object.entries(d.assetDistribution ?? {});
  const currencyEntries = Object.entries(d.currencyDistribution ?? {});
  const alerts = Array.isArray(d.alerts) ? d.alerts : [];

  return (
    <div>
      {/* 顶部标题栏 */}
      <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <span style={{ fontSize: 20, fontWeight: 600 }}>经济运营看板</span>
        </Col>
        <Col>
          <Space>
            {healthTag}
            <Tag color="blue">生成时间：{generatedAt}</Tag>
            <Button
              icon={<ReloadOutlined />}
              onClick={load}
              loading={loading}
            >
              刷新
            </Button>
          </Space>
        </Col>
      </Row>

      {/* 通胀面板 */}
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title="通胀指标" bordered>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}>
                <Statistic
                  title="月通胀率"
                  value={fmtRate(d.monthlyInflationRate)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="季度通胀率"
                  value={fmtRate(d.quarterlyInflationRate)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="年度通胀率"
                  value={fmtRate(d.annualInflationRate)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="CPI"
                  value={d.cpi != null ? d.cpi : '—'}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* 资产总量与流通 */}
        <Col xs={24} md={12}>
          <Card title="资产总量与流通" bordered>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic
                  title="资产总量"
                  value={fmtNumber(d.totalAssets)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="金币存量"
                  value={fmtNumber(d.goldStock)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="30 天流入"
                  value={fmtNumber(d.goldInflow30d)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="30 天流出"
                  value={fmtNumber(d.goldOutflow30d)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={24}>
                <Statistic
                  title="30 天货币流通速度"
                  value={d.velocity30d != null ? d.velocity30d : '—'}
                  precision={d.velocity30d != null ? 2 : undefined}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* 冻结与回收 */}
        <Col xs={24} md={12}>
          <Card title="冻结与回收" bordered>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic
                  title="冻结资产总额"
                  value={fmtNumber(d.frozenAssets)}
                  valueStyle={{ fontSize: 22, color: d.frozenAssets ? '#d48806' : undefined }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="冻结玩家数"
                  value={d.frozenPlayerCount ?? 0}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="30 天回收额"
                  value={fmtNumber(d.recoveredAmount30d)}
                  valueStyle={{ fontSize: 22, color: d.recoveredAmount30d ? '#389e0d' : undefined }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="30 天回收笔数"
                  value={d.recoveredCount30d ?? 0}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* 资产分布 */}
        {assetEntries.length > 0 && (
          <Col xs={24} md={12}>
            <Card title="资产分布" bordered>
              <Row gutter={[8, 8]}>
                {assetEntries.map(([k, v]) => (
                  <Col span={12} key={k}>
                    <Statistic
                      title={k}
                      value={typeof v === 'object' ? JSON.stringify(v) : fmtNumber(v)}
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                ))}
              </Row>
            </Card>
          </Col>
        )}

        {/* 货币分布 */}
        {currencyEntries.length > 0 && (
          <Col xs={24} md={12}>
            <Card title="货币分布" bordered>
              <Row gutter={[8, 8]}>
                {currencyEntries.map(([k, v]) => (
                  <Col span={12} key={k}>
                    <Statistic
                      title={k}
                      value={typeof v === 'object' ? JSON.stringify(v) : fmtNumber(v)}
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                ))}
              </Row>
            </Card>
          </Col>
        )}

        {/* 异常提示 */}
        {alerts.length > 0 && (
          <Col xs={24}>
            <Card title="异常提示" bordered>
              <div style={{ color: '#cf1322' }}>
                {alerts.map((a, i) => (
                  <div key={i}>• {a}</div>
                ))}
              </div>
            </Card>
          </Col>
        )}
      </Row>
    </div>
  );
}
