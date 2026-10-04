import { useMemo, useState } from 'react';
import {
  Button,
  Descriptions,
  Drawer,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
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
            ]}
          />
        </Spin>
      </Drawer>
    </>
  );
}
