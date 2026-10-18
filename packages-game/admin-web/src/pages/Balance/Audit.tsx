import { useEffect, useState } from 'react';
import { Card, Col, Empty, Row, Spin, Statistic, Tag } from 'antd';
import client from '../../api/client';

interface SocialSection {
  newPlayerCount?: number;
  socialCurrencyFlow?: Record<string, any>;
  activePlayers?: number;
}

interface CombatSection {
  pvpBattles?: number;
  pvpWinRate?: number | null;
  distribution?: Record<string, any>;
}

interface EconomySection {
  goldStock?: string | number;
  goldInflow30d?: string | number;
  monthlyInflationRate?: number | null;
}

interface GrowthSection {
  playerCount?: number;
  levelDistribution?: Record<string, number>;
  avgHoursPerLevel?: number | null;
}

interface BalanceAuditResponse {
  social?: SocialSection;
  combat?: CombatSection;
  economy?: EconomySection;
  growth?: GrowthSection;
  health?: boolean;
  generatedAt?: string;
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

function fmtValue(v: any): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'object') {
    if (Array.isArray(v)) return v.map((x: any) => fmtValue(x)).join(', ');
    return Object.entries(v)
      .map(([k, val]) => `${k}:${fmtValue(val)}`)
      .join(', ');
  }
  return String(v);
}

export default function BalanceAuditPage() {
  const [data, setData] = useState<BalanceAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await client.get('/admin/v1/balance/audit');
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
    return <Empty description="暂无数据" />;
  }

  const generatedAt = formatGeneratedAt(data.generatedAt);
  const healthTag = data.health === true
    ? <Tag color="green">● 健康</Tag>
    : data.health === false
    ? <Tag color="red">● 异常</Tag>
    : <Tag color="default">● 未知</Tag>;

  const social = data.social ?? {};
  const combat = data.combat ?? {};
  const economy = data.economy ?? {};
  const growth = data.growth ?? {};

  const socialFlowEntries = Object.entries(social.socialCurrencyFlow ?? {});
  const combatDistEntries = Object.entries(combat.distribution ?? {});
  const levelDistEntries = Object.entries(growth.levelDistribution ?? {});

  return (
    <div>
      {/* 顶部状态条 */}
      <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <span style={{ fontSize: 20, fontWeight: 600 }}>经济运营分析</span>
        </Col>
        <Col>{healthTag}</Col>
        <Col>
          <Tag color="blue">生成时间：{generatedAt}</Tag>
        </Col>
      </Row>

      {/* 主面板：四个分区 */}
      <Row gutter={[16, 16]}>
        {/* Social 社交 */}
        <Col xs={24} md={12}>
          <Card title="社交" bordered>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic
                  title="活跃玩家"
                  value={social.activePlayers ?? 0}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="新玩家"
                  value={social.newPlayerCount ?? 0}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
            </Row>
            {socialFlowEntries.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>社交货币流动</div>
                <Row gutter={[8, 8]}>
                  {socialFlowEntries.map(([k, v]) => (
                    <Col span={12} key={k}>
                      <Statistic title={k} value={fmtValue(v)} valueStyle={{ fontSize: 16 }} />
                    </Col>
                  ))}
                </Row>
              </div>
            )}
          </Card>
        </Col>

        {/* Combat 战斗 */}
        <Col xs={24} md={12}>
          <Card title="战斗" bordered>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic
                  title="PvP 场次"
                  value={combat.pvpBattles ?? 0}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="PvP 胜率"
                  value={combat.pvpWinRate != null ? combat.pvpWinRate : 0}
                  suffix={combat.pvpWinRate != null ? '%' : undefined}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
            </Row>
            {combatDistEntries.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>战斗分布</div>
                <Row gutter={[8, 8]}>
                  {combatDistEntries.map(([k, v]) => (
                    <Col span={12} key={k}>
                      <Statistic title={k} value={fmtValue(v)} valueStyle={{ fontSize: 16 }} />
                    </Col>
                  ))}
                </Row>
              </div>
            )}
          </Card>
        </Col>

        {/* Economy 经济 */}
        <Col xs={24} md={12}>
          <Card title="经济" bordered>
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Statistic
                  title="金币存量"
                  value={fmtValue(economy.goldStock)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="30 天流入"
                  value={fmtValue(economy.goldInflow30d)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="月通胀率"
                  value={economy.monthlyInflationRate ?? 0}
                  suffix={economy.monthlyInflationRate != null ? '%' : undefined}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* Growth 成长 */}
        <Col xs={24} md={12}>
          <Card title="成长" bordered>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic
                  title="玩家总数"
                  value={growth.playerCount ?? 0}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="平均每级小时"
                  value={growth.avgHoursPerLevel ?? 0}
                  suffix={growth.avgHoursPerLevel != null ? 'h' : undefined}
                  valueStyle={{ fontSize: 22 }}
                />
              </Col>
            </Row>
            {levelDistEntries.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>等级分布</div>
                <Row gutter={[8, 8]}>
                  {levelDistEntries.map(([k, v]) => (
                    <Col span={8} key={k}>
                      <Statistic title={`Lv.${k}`} value={fmtValue(v)} valueStyle={{ fontSize: 16 }} />
                    </Col>
                  ))}
                </Row>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
