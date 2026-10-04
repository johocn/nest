import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface Player {
  id: number | string;
  accountId?: string;
  nickname?: string;
  avatarUrl?: string;
  level?: number;
  exp?: number;
  vipLevel?: number;
  vipExp?: number;
  totalRecharge?: number;
  onlineStatus?: boolean;
  lastActivityAt?: string;
  lastLogoutAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface CurrencyInfo {
  currencyType: string;
  amount: number;
}

const CURRENCY_COLOR_MAP: Record<string, string> = {
  gold: 'gold',
  diamond: 'cyan',
  favor: 'magenta',
  guild_contrib: 'blue',
  face: 'purple',
};

const currencyColumns: ColumnsType<CurrencyInfo> = [
  {
    title: '货币类型',
    dataIndex: 'currencyType',
    width: 160,
    render: (v: string) => (
      <Tag color={CURRENCY_COLOR_MAP[v] || 'default'}>{v}</Tag>
    ),
  },
  { title: '数量', dataIndex: 'amount', width: 160 },
];

export default function PlayerPage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playerDetail, setPlayerDetail] = useState<Player | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);

  const [adjustLoading, setAdjustLoading] = useState(false);
  const [penaltyLoading, setPenaltyLoading] = useState(false);
  const [kickLoading, setKickLoading] = useState(false);

  const [gmAdjustForm] = Form.useForm();
  const [gmPenaltyForm] = Form.useForm();

  const fetchList = (page: number, limit: number) =>
    client.get('/admin/v1/player/list', { params: { page, limit } });

  const handleDetail = async (id: number | string) => {
    setDetailOpen(true);
    setLoading(true);
    try {
      const { data } = await client.get(`/admin/v1/player/${id}/detail`);
      setPlayerDetail(data?.player ?? null);
      setCurrencies(data?.currencies ?? []);
    } finally {
      setLoading(false);
    }
  };

  const submitAdjust = async () => {
    try {
      const values = await gmAdjustForm.validateFields();
      setAdjustLoading(true);
      await client.put(`/admin/v1/social/points/${playerDetail?.id}`, {
        delta: values.delta,
        note: values.note,
      });
      message.success('积分调整成功');
      gmAdjustForm.resetFields();
    } catch {
      // axios interceptor handles error toast
    } finally {
      setAdjustLoading(false);
    }
  };

  const submitPenalty = async () => {
    try {
      const values = await gmPenaltyForm.validateFields();
      setPenaltyLoading(true);
      await client.post('/admin/v1/auth/penalties', {
        playerId: playerDetail?.id,
        accountId: playerDetail?.accountId,
        level: values.level,
        reason: values.reason,
        durationSeconds: values.durationSeconds,
      });
      message.success('处罚执行成功');
      gmPenaltyForm.resetFields();
    } catch {
      // axios interceptor handles error toast
    } finally {
      setPenaltyLoading(false);
    }
  };

  const kickPlayer = async () => {
    try {
      if (!playerDetail?.accountId) {
        message.error('缺少 accountId，无法踢下线');
        return;
      }
      setKickLoading(true);
      await client.post(`/admin/v1/auth/players/${playerDetail.accountId}/logout`);
      message.success('踢下线成功');
    } catch {
      // axios interceptor handles error toast
    } finally {
      setKickLoading(false);
    }
  };

  const columns = useMemo<ColumnsType<Player>>(
    () => [
      { title: '玩家 ID', dataIndex: 'id', width: 80 },
      {
        title: '昵称',
        dataIndex: 'nickname',
        render: (v: string) => v || '-',
      },
      { title: '等级', dataIndex: 'level', width: 80 },
      { title: 'VIP', dataIndex: 'vipLevel', width: 80 },
      {
        title: '充值',
        dataIndex: 'totalRecharge',
        width: 100,
        render: (v: number) => String(v ?? 0) + ' 元',
      },
      {
        title: '在线',
        dataIndex: 'onlineStatus',
        width: 80,
        render: (v: boolean) =>
          v ? <Tag color="green">在线</Tag> : <Tag>离线</Tag>,
      },
      {
        title: '最后活动',
        dataIndex: 'lastActivityAt',
        width: 180,
        render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
      },
      { title: '创建时间', dataIndex: 'createdAt', width: 180 },
      {
        title: '操作',
        key: 'action',
        width: 100,
        render: (_: any, r) => (
          <Space>
            <Button size="small" onClick={() => handleDetail(r.id)}>
              详情
            </Button>
          </Space>
        ),
      },
    ],
    [],
  );

  const detailItems = useMemo(() => {
    if (!playerDetail) return [];
    return [
      { key: 'id', label: 'ID', children: playerDetail.id },
      { key: 'nickname', label: '昵称', children: playerDetail.nickname || '-' },
      { key: 'level', label: '等级', children: playerDetail.level ?? '-' },
      { key: 'vipLevel', label: 'VIP 等级', children: playerDetail.vipLevel ?? '-' },
      { key: 'vipExp', label: 'VIP 经验', children: playerDetail.vipExp ?? '-' },
      {
        key: 'totalRecharge',
        label: '累计充值',
        children: (playerDetail.totalRecharge ?? 0) + ' 元',
      },
      {
        key: 'onlineStatus',
        label: '在线状态',
        children: playerDetail.onlineStatus ? (
          <Tag color="green">在线</Tag>
        ) : (
          <Tag>离线</Tag>
        ),
      },
      {
        key: 'createdAt',
        label: '创建时间',
        children: playerDetail.createdAt
          ? new Date(playerDetail.createdAt).toLocaleString()
          : '-',
      },
      {
        key: 'updatedAt',
        label: '更新时间',
        children: playerDetail.updatedAt
          ? new Date(playerDetail.updatedAt).toLocaleString()
          : '-',
      },
    ];
  }, [playerDetail]);

  return (
    <>
      <AdminTable<Player>
        rowKey="id"
        title="玩家管理"
        columns={columns}
        fetchFn={fetchList}
      />

      <Drawer
        open={detailOpen}
        title={playerDetail ? `玩家详情 #${playerDetail.id}` : '玩家详情'}
        width={720}
        onClose={() => setDetailOpen(false)}
        destroyOnClose
      >
        <Spin spinning={loading} tip="加载中...">
          <Tabs
            defaultActiveKey="basic"
            items={[
              {
                key: 'basic',
                label: '基础信息',
                children: (
                  <Descriptions
                    column={2}
                    bordered
                    size="small"
                    items={detailItems}
                  />
                ),
              },
              {
                key: 'currencies',
                label: '货币',
                children: (
                  <Table<CurrencyInfo>
                    rowKey="currencyType"
                    size="small"
                    pagination={false}
                    dataSource={currencies}
                    columns={currencyColumns}
                  />
                ),
              },
              {
                key: 'gm',
                label: 'GM操作',
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size="large">
                    {/* Panel 1: Social Points */}
                    <Card title="社交积分调整" size="small">
                      <Form
                        form={gmAdjustForm}
                        layout="inline"
                        style={{ gap: 8 }}
                      >
                        <Form.Item label="delta (正加负扣)" name="delta" rules={[{ required: true }]}>
                          <InputNumber placeholder="e.g. 100 / -50" style={{ width: 180 }} />
                        </Form.Item>
                        <Form.Item label="原因" name="note">
                          <Input placeholder="补发/回收原因" style={{ width: 240 }} />
                        </Form.Item>
                        <Form.Item>
                          <Button type="primary" onClick={submitAdjust} loading={adjustLoading}>执行</Button>
                        </Form.Item>
                      </Form>
                    </Card>

                    {/* Panel 2: Penalty */}
                    <Card title="分级处罚" size="small">
                      <Form form={gmPenaltyForm} layout="vertical">
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item label="玩家ID" name="playerId" initialValue={playerDetail?.id} rules={[{ required: true }]}>
                              <Input disabled />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label="账号ID" name="accountId" initialValue={playerDetail?.accountId} rules={[{ required: true }]}>
                              <Input disabled />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="处罚等级" name="level" rules={[{ required: true }]}>
                              <Select
                                options={[
                                  { value: 'warning', label: '警告 warning' },
                                  { value: 'mute', label: '禁言 mute' },
                                  { value: 'guild_remove', label: '帮派除名 guild_remove' },
                                  { value: 'trade_limit', label: '限交易 trade_limit' },
                                  { value: 'ban', label: '封禁 ban' },
                                ]}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="时长(秒)" name="durationSeconds">
                              <InputNumber placeholder="可选" style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={24}>
                            <Form.Item label="原因" name="reason" rules={[{ required: true }]}>
                              <Input.TextArea rows={2} placeholder="处罚原因（必填）" />
                            </Form.Item>
                          </Col>
                          <Col span={24}>
                            <Button danger type="primary" onClick={submitPenalty} loading={penaltyLoading}>执行处罚</Button>
                          </Col>
                        </Row>
                      </Form>
                    </Card>

                    {/* Panel 3: Kick */}
                    <Card title="踢下线" size="small">
                      <p style={{ color: '#888' }}>
                        强制使该账号所有端 token 失效（accountId = {playerDetail?.accountId ?? '-'}）
                      </p>
                      <Popconfirm
                        title="确认踢下线？"
                        description={`玩家 ${playerDetail?.nickname ?? ''} 将被强制登出所有端`}
                        onConfirm={kickPlayer}
                        okText="确认踢下线"
                        cancelText="取消"
                      >
                        <Button danger loading={kickLoading}>踢下线</Button>
                      </Popconfirm>
                    </Card>
                  </Space>
                ),
              },
            ]}
          />
        </Spin>
      </Drawer>
    </>
  );
}
