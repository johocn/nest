import { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Tag, Modal, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import client from '../../api/client';

interface LadderPlayer {
  rank: number;
  playerId: string;
  score: number;
  tier: string;
}

const tierColor: Record<string, string> = {
  青铜: 'default',
  白银: 'blue',
  黄金: 'gold',
  宗师: 'purple',
};

export default function Ladder() {
  const [data, setData] = useState<LadderPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [settling, setSettling] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await client.get('/admin/v1/ladder/top', {
        params: { limit: 50 },
      });
      setData(res.data?.data ?? []);
    } catch {
      // 拦截器已处理
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSettle = () => {
    Modal.confirm({
      title: '赛季结算',
      content: '将对当前赛季 TOP 50 发奖，确认？',
      okText: '确认结算',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setSettling(true);
        try {
          const res = await client.post('/admin/v1/ladder/settle');
          const rewardsSent = res.data?.data?.rewardsSent ?? 0;
          message.success(`结算完成，已发放 ${rewardsSent} 份奖励`);
          load();
        } catch {
          // 拦截器已处理
        } finally {
          setSettling(false);
        }
      },
    });
  };

  const columns = [
    {
      title: '排名',
      dataIndex: 'rank',
      width: 80,
      render: (r: number) => (
        <span style={{ fontWeight: 600 }}>#{r}</span>
      ),
    },
    {
      title: '玩家 ID',
      dataIndex: 'playerId',
    },
    {
      title: '分数',
      dataIndex: 'score',
      width: 120,
      sorter: (a: LadderPlayer, b: LadderPlayer) => a.score - b.score,
    },
    {
      title: '段位',
      dataIndex: 'tier',
      width: 120,
      render: (t: string) => (
        <Tag color={tierColor[t] ?? 'default'}>{t}</Tag>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="天梯排行榜（Redis ZSet 实时）"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
              刷新
            </Button>
            <Button danger onClick={handleSettle} loading={settling}>
              赛季结算
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="playerId"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      </Card>
    </div>
  );
}
