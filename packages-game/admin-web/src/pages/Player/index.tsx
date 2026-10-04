import { useMemo, useState } from 'react';
import { Button, Modal, Space, Tag } from 'antd';
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

export default function PlayerPage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [current, setCurrent] = useState<Player | null>(null);

  const fetchList = (page: number, limit: number) =>
    client.get('/admin/v1/player/list', { params: { page, limit } });

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
            <Button
              size="small"
              onClick={() => {
                setCurrent(r);
                setDetailOpen(true);
              }}
            >
              详情
            </Button>
          </Space>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <AdminTable<Player>
        rowKey="id"
        title="玩家管理"
        columns={columns}
        fetchFn={fetchList}
      />

      <Modal
        open={detailOpen}
        title="玩家详情"
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
