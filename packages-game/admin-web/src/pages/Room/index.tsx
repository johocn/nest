import { useEffect, useRef, useState } from 'react';
import { Card, Table, Button, Tag, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import client from '../../api/client';

interface RoomPlayer {
  playerId: string;
  role: string;
  ready: boolean;
  joinedAt: string;
}

interface Room {
  id: string;
  mode: string;
  status: string;
  players: RoomPlayer[];
  maxPlayers: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

const statusColor: Record<string, string> = {
  forming: 'blue',
  ready: 'cyan',
  in_progress: 'green',
  finished: 'default',
  timeout: 'red',
  matching: 'orange',
};

export default function RoomPage() {
  const [data, setData] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await client.get('/admin/v1/ops/rooms');
      setData(res.data?.data ?? []);
    } catch {
      // 拦截器已处理
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    timerRef.current = window.setInterval(load, 5000);
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const columns = [
    {
      title: 'Room ID',
      dataIndex: 'id',
      width: 200,
      render: (id: string) => <code>{id}</code>,
    },
    {
      title: '模式',
      dataIndex: 'mode',
      width: 100,
      render: (m: string) => <Tag>{m}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (s: string) => (
        <Tag color={statusColor[s] ?? 'default'}>{s}</Tag>
      ),
    },
    {
      title: '玩家',
      width: 120,
      render: (_: unknown, record: Room) =>
        `${record.players.length}/${record.maxPlayers}`,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 220,
      render: (t: string) => new Date(t).toLocaleString(),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="实时 Room 列表（5s 自动刷新）"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
              立即刷新
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      </Card>
    </div>
  );
}
