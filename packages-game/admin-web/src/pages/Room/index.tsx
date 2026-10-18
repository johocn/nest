import { useEffect, useState } from 'react';
import { Tag, Space } from 'antd';
import AdminTable from '../../components/AdminTable';
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
  // reloadKey 变化触发 AdminTable 重新 fetch
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setReloadKey((k) => k + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const fetchRooms = async () => {
    const res = await client.get('/admin/v1/ops/rooms');
    return res.data?.data ?? [];
  };

  return (
    <div style={{ padding: 24 }}>
      <AdminTable<Room>
        rowKey="id"
        title="实时 Room 列表（5s 自动刷新）"
        fetchFn={fetchRooms}
        deps={[reloadKey]}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: 'Room ID', dataIndex: 'id', width: 200, render: (id: string) => <code>{id}</code> },
          { title: '模式', dataIndex: 'mode', width: 100, render: (m: string) => <Tag>{m}</Tag> },
          { title: '状态', dataIndex: 'status', width: 120, render: (s: string) => <Tag color={statusColor[s] ?? 'default'}>{s}</Tag> },
          { title: '玩家', width: 120, render: (_: unknown, record: Room) => `${record.players.length}/${record.maxPlayers}` },
          { title: '创建时间', dataIndex: 'createdAt', width: 220, render: (t: string) => new Date(t).toLocaleString() },
        ]}
      />
    </div>
  );
}
