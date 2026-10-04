import { useEffect, useMemo, useState } from 'react';
import {
  Tabs,
  Card,
  Row,
  Col,
  Statistic,
  Tag,
  Empty,
  Spin,
  Button,
  DatePicker,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import client from '../../api/client';

// ---------- helpers ----------

function formatGeneratedAt(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function extractData(res: any): any {
  const env = res?.data ?? res;
  return env?.code === 0 ? env.data : env;
}

// ---------- 运营概览 ----------

interface DashboardResponse {
  dau: number;
  behaviorStats: any[];
  generatedAt?: string;
}

function OverviewTab({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    client
      .get('/admin/v1/analytics/dashboard')
      .then((res) => {
        const payload = extractData(res);
        setData(payload || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (!data) {
    return <Empty description="暂无数据" />;
  }

  const generatedAt = formatGeneratedAt(data.generatedAt);
  const behaviorList = Array.isArray(data.behaviorStats) ? data.behaviorStats : [];

  return (
    <div>
      <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <span style={{ fontSize: 20, fontWeight: 600 }}>运营概览</span>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Tag color="blue" style={{ marginLeft: 8 }}>
            数据生成时间：{generatedAt}
          </Tag>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="DAU"
              value={data.dau ?? 0}
              suffix="日活跃"
              valueStyle={{ fontSize: 28 }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="行为统计" style={{ marginTop: 16 }}>
        {behaviorList.length === 0 ? (
          <Empty description="暂无行为数据" />
        ) : (
          <pre
            style={{
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 4,
              maxHeight: 500,
              overflow: 'auto',
              margin: 0,
            }}
          >
            {JSON.stringify(behaviorList, null, 2)}
          </pre>
        )}
      </Card>
    </div>
  );
}

// ---------- 社交分析 ----------

interface SocialFunnel {
  newPlayerCount?: number;
  relatedCount?: number;
  relationRate?: number;
  threshold?: number;
  healthy?: boolean;
  detail?: {
    withFriend?: number;
    withGuild?: number;
    withKinship?: number;
  };
}

interface SocialGraph {
  nodes: any[];
  edges: any[];
}

function SocialTab({ reloadKey }: { reloadKey: number }) {
  const [funnel, setFunnel] = useState<SocialFunnel | null>(null);
  const [funnelErr, setFunnelErr] = useState<string | null>(null);

  const [churn, setChurn] = useState<any[] | null>(null);
  const [churnErr, setChurnErr] = useState<string | null>(null);

  const [hubs, setHubs] = useState<any[] | null>(null);
  const [hubsErr, setHubsErr] = useState<string | null>(null);

  const [graph, setGraph] = useState<SocialGraph | null>(null);
  const [graphErr, setGraphErr] = useState<string | null>(null);

  const fetchAll = () => {
    client
      .get('/admin/v1/analytics/social/funnel')
      .then((res) => {
        setFunnel(extractData(res));
        setFunnelErr(null);
      })
      .catch((e) => setFunnelErr(e?.message ?? '请求失败'));

    client
      .get('/admin/v1/analytics/social/churn-risk')
      .then((res) => {
        setChurn(extractData(res) ?? []);
        setChurnErr(null);
      })
      .catch((e) => setChurnErr(e?.message ?? '请求失败'));

    client
      .get('/admin/v1/analytics/social/hubs')
      .then((res) => {
        setHubs(extractData(res) ?? []);
        setHubsErr(null);
      })
      .catch((e) => setHubsErr(e?.message ?? '请求失败'));

    client
      .get('/admin/v1/analytics/social/graph')
      .then((res) => {
        const d = extractData(res) ?? {};
        setGraph({ nodes: d.nodes ?? [], edges: d.edges ?? [] });
        setGraphErr(null);
      })
      .catch((e) => setGraphErr(e?.message ?? '请求失败'));
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return (
    <div>
      <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <span style={{ fontSize: 20, fontWeight: 600 }}>社交分析</span>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>
            刷新
          </Button>
        </Col>
      </Row>

      <Card title="社交关系漏斗" style={{ marginBottom: 16 }}>
        {funnelErr ? (
          <Tag color="red">加载失败：{funnelErr}</Tag>
        ) : !funnel ? (
          <Spin tip="加载中..." />
        ) : (
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title="新玩家数" value={funnel.newPlayerCount ?? 0} />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title="产生关联玩家" value={funnel.relatedCount ?? 0} />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title="关联率" value={funnel.relationRate ?? 0} suffix="%" />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title="健康阈值" value={funnel.threshold ?? 0} suffix="%" />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic title="健康状态" value={funnel.healthy ? '健康' : '异常'} />
            </Col>
            <Col xs={24} sm={12} md={8} lg={4}>
              <Statistic
                title="好友/公会/结义"
                value={`${funnel.detail?.withFriend ?? 0} / ${funnel.detail?.withGuild ?? 0} / ${funnel.detail?.withKinship ?? 0}`}
              />
            </Col>
          </Row>
        )}
      </Card>

      <Card title="流失风险预警" style={{ marginBottom: 16 }}>
        {churnErr ? (
          <Tag color="red">加载失败：{churnErr}</Tag>
        ) : churn === null ? (
          <Spin tip="加载中..." />
        ) : churn.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 400, overflow: 'auto', margin: 0 }}>
            {JSON.stringify(churn, null, 2)}
          </pre>
        )}
      </Card>

      <Card title="社交枢纽（Hubs）" style={{ marginBottom: 16 }}>
        {hubsErr ? (
          <Tag color="red">加载失败：{hubsErr}</Tag>
        ) : hubs === null ? (
          <Spin tip="加载中..." />
        ) : hubs.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 400, overflow: 'auto', margin: 0 }}>
            {JSON.stringify(hubs, null, 2)}
          </pre>
        )}
      </Card>

      <Card title="社交关系图谱概览">
        {graphErr ? (
          <Tag color="red">加载失败：{graphErr}</Tag>
        ) : graph === null ? (
          <Spin tip="加载中..." />
        ) : (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}>
                <Statistic title="节点数 (nodes)" value={graph.nodes.length} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="边数 (edges)" value={graph.edges.length} />
              </Col>
            </Row>
            <div style={{ marginTop: 16 }}>
              <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 500, overflow: 'auto', margin: 0, fontSize: 12 }}>
                {JSON.stringify(graph, null, 2)}
              </pre>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ---------- 留存分析 ----------

function RetentionTab({ reloadKey }: { reloadKey: number }) {
  const defaultCohort = useMemo(() => dayjs().subtract(7, 'day'), []);
  const [cohortDate, setCohortDate] = useState<Dayjs>(defaultCohort);
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setErr(null);
    const dateStr = cohortDate.format('YYYY-MM-DD');
    client
      .get(`/admin/v1/analytics/retention/${dateStr}`)
      .then((res) => {
        const payload = extractData(res);
        const list = Array.isArray(payload) ? payload : payload?.list ?? [];
        setData(list);
      })
      .catch((e) => setErr(e?.message ?? '请求失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const handleChange = (val: Dayjs | null) => {
    if (val) setCohortDate(val);
  };

  return (
    <div>
      <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <span style={{ fontSize: 20, fontWeight: 600 }}>留存分析</span>
        </Col>
        <Col>
          <span style={{ marginRight: 8 }}>分组日期 (cohortDate)：</span>
          <DatePicker
            value={cohortDate}
            onChange={handleChange}
            format="YYYY-MM-DD"
            allowClear={false}
          />
          <Button type="primary" icon={<ReloadOutlined />} onClick={load} style={{ marginLeft: 8 }}>
            查询
          </Button>
        </Col>
      </Row>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" tip="加载中..." />
        </div>
      ) : err ? (
        <Tag color="red">加载失败：{err}</Tag>
      ) : !data || data.length === 0 ? (
        <Empty description="暂无数据" />
      ) : (
        <Card title={`留存数据（${cohortDate.format('YYYY-MM-DD')}）`}>
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 600, overflow: 'auto', margin: 0 }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}

// ---------- 主入口 ----------

export default function DashboardPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [activeKey, setActiveKey] = useState<string>('overview');

  const triggerReload = () => setReloadKey((k) => k + 1);

  return (
    <div style={{ padding: 16 }}>
      <Tabs
        activeKey={activeKey}
        onChange={(k) => {
          setActiveKey(k);
          triggerReload();
        }}
        items={[
          { key: 'overview', label: '运营概览', children: <OverviewTab reloadKey={reloadKey} /> },
          { key: 'social', label: '社交分析', children: <SocialTab reloadKey={reloadKey} /> },
          { key: 'retention', label: '留存分析', children: <RetentionTab reloadKey={reloadKey} /> },
        ]}
      />
    </div>
  );
}
