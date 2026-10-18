import { useState } from 'react';
import { Button, Space, Tag, Modal, message } from 'antd';
import AdminTable from '../../components/AdminTable';
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
  const [settling, setSettling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchTop = async () => {
    const res = await client.get('/admin/v1/ladder/top', { params: { limit: 50 } });
    // 返回数组 → hook 自动: data=list, total=list.length
    return res.data?.data ?? [];
  };

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
          triggerReload();
        } catch { /* 拦截器已处理 */ }
        finally { setSettling(false); }
      },
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <AdminTable<LadderPlayer>
        rowKey="playerId"
        title="天梯排行榜（Redis ZSet 实时 TOP 50）"
        fetchFn={fetchTop}
        deps={[reloadKey]}
        pagination={{ pageSize: 50, showSizeChanger: false, showTotal: (t) => `共 TOP ${t} 位` }}
        extra={
          <Space>
            <Button danger onClick={handleSettle} loading={settling}>
              赛季结算
            </Button>
          </Space>
        }
        columns={[
          { title: '排名', dataIndex: 'rank', width: 80, render: (r: number) => <span style={{ fontWeight: 600 }}>#{r}</span> },
          { title: '玩家 ID', dataIndex: 'playerId' },
          { title: '分数', dataIndex: 'score', width: 120, sorter: (a: LadderPlayer, b: LadderPlayer) => a.score - b.score },
          { title: '段位', dataIndex: 'tier', width: 120, render: (t: string) => <Tag color={tierColor[t] ?? 'default'}>{t}</Tag> },
        ]}
      />
    </div>
  );
}
