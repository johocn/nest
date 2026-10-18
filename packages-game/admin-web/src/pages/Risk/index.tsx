import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

// ---------- 类型 ----------

interface RiskDashboard {
  top: any[];
  pending: number;
}

interface RiskCase {
  id: number | string;
  playerId?: number | string;
  type?: string;
  severity?: string;
  status?: string;
  createdAt?: string;
  [key: string]: any;
}

const DISPOSE_ACTION_OPTIONS = [
  { value: 'frozen', label: '冻结 frozen' },
  { value: 'ignored', label: '忽略 ignored' },
];

const PENALTY_LEVEL_OPTIONS = [
  { value: 'warning', label: '警告 warning' },
  { value: 'mute', label: '禁言 mute' },
  { value: 'guild_remove', label: '帮派除名 guild_remove' },
  { value: 'trade_limit', label: '限交易 trade_limit' },
  { value: 'ban', label: '封禁 ban' },
];

// ---------- 子组件：处置 Modal ----------

function DisposeModal({
  open,
  record,
  onCancel,
  onSuccess,
}: {
  open: boolean;
  record: RiskCase | null;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await client.post(`/admin/v1/risk/cases/${record?.id}/dispose`, {
        action: values.action,
        note: values.note,
      });
      message.success('处置成功');
      onSuccess();
    } catch (e: any) {
      // 拦截器会统一处理错误提示
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="处置风控线索"
      onCancel={onCancel}
      onOk={handleOk}
      okText="确认处置"
      confirmLoading={loading}
      destroyOnClose
    >
      <div style={{ marginBottom: 12, color: '#888' }}>
        案件 ID: <b>{record?.id}</b> ｜ 玩家 ID: <b>{record?.playerId ?? '-'}</b>
      </div>
      <Form form={form} layout="vertical">
        <Form.Item
          label="处置动作"
          name="action"
          rules={[{ required: true, message: '请选择处置动作' }]}
        >
          <Select options={DISPOSE_ACTION_OPTIONS} placeholder="请选择处置动作" />
        </Form.Item>
        <Form.Item label="备注" name="note">
          <Input.TextArea rows={3} placeholder="可选，填写处置原因或备注" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---------- 子组件：锁定/处罚 Modal ----------

function LockModal({
  open,
  record,
  onCancel,
  onSuccess,
}: {
  open: boolean;
  record: RiskCase | null;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await client.post(`/admin/v1/risk/cases/${record?.id}/lock`, {
        level: values.level,
        reason: values.reason,
      });
      message.success('锁定成功');
      onSuccess();
    } catch (e: any) {
      // 拦截器处理
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="锁定玩家账号"
      onCancel={onCancel}
      onOk={handleOk}
      okText="确认锁定"
      okButtonProps={{ danger: true }}
      confirmLoading={loading}
      destroyOnClose
    >
      <div style={{ marginBottom: 12, color: '#888' }}>
        案件 ID: <b>{record?.id}</b> ｜ 玩家 ID: <b>{record?.playerId ?? '-'}</b>
      </div>
      <Form form={form} layout="vertical">
        <Form.Item
          label="处罚等级"
          name="level"
          rules={[{ required: true, message: '请选择处罚等级' }]}
        >
          <Select options={PENALTY_LEVEL_OPTIONS} placeholder="请选择处罚等级" />
        </Form.Item>
        <Form.Item
          label="原因"
          name="reason"
          rules={[{ required: true, message: '请填写锁定原因' }]}
        >
          <Input.TextArea rows={3} placeholder="必填，填写锁定原因" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---------- 子组件：回收 Modal（两步） ----------

function RecoverModal({
  open,
  record,
  onCancel,
  onSuccess,
}: {
  open: boolean;
  record: RiskCase | null;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [step, setStep] = useState<1 | 2>(1);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [proposal, setProposal] = useState<any>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setProposal(null);
      form.resetFields();
    }
  }, [open, form]);

  // 第一步：获取回收建议
  const loadProposal = useCallback(async () => {
    if (!record) return;
    try {
      setProposalLoading(true);
      const res = await client.post(`/admin/v1/risk/cases/${record.id}/recover-proposal`);
      const envelope = res?.data ?? res;
      const body = envelope?.code === 0 ? envelope.data : envelope;
      setProposal(body);
      setStep(2);
    } catch (e: any) {
      // 拦截器处理
    } finally {
      setProposalLoading(false);
    }
  }, [record]);

  useEffect(() => {
    if (open && record && step === 1) {
      loadProposal();
    }
  }, [open, record, step, loadProposal]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitLoading(true);
      await client.post(`/admin/v1/risk/cases/${record?.id}/recover`, {
        note: values.note,
      });
      message.success('回收成功');
      onSuccess();
    } catch (e: any) {
      // 拦截器处理
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="回收涉案物品"
      onCancel={onCancel}
      onOk={step === 2 ? handleOk : undefined}
      okText={step === 2 ? '确认回收' : '加载中'}
      confirmLoading={step === 2 ? submitLoading : proposalLoading}
      okButtonProps={step === 2 ? { danger: true } : { disabled: true }}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        step === 2 && (
          <Button
            key="confirm"
            type="primary"
            danger
            loading={submitLoading}
            onClick={handleOk}
          >
            确认回收
          </Button>
        ),
      ].filter(Boolean)}
    >
      <div style={{ marginBottom: 12, color: '#888' }}>
        案件 ID: <b>{record?.id}</b> ｜ 玩家 ID: <b>{record?.playerId ?? '-'}</b>
      </div>

      {step === 1 && (
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
          正在获取回收建议...
        </div>
      )}

      {step === 2 && proposal && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="系统回收建议"
            description={
              <pre
                style={{
                  background: '#fff',
                  margin: 0,
                  maxHeight: 200,
                  overflow: 'auto',
                  fontSize: 12,
                }}
              >
                {JSON.stringify(proposal, null, 2)}
              </pre>
            }
          />
          <Form form={form} layout="vertical">
            <Form.Item label="回收备注" name="note">
              <Input.TextArea rows={3} placeholder="可选，填写回收备注" />
            </Form.Item>
          </Form>
        </>
      )}

      {step === 2 && !proposal && (
        <Empty description="未获取到回收建议，请手动确认" />
      )}
    </Modal>
  );
}

// ---------- 子组件：白名单 Modal ----------

function WhitelistModal({
  open,
  onCancel,
  onSuccess,
}: {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await client.post('/admin/v1/risk/whitelist', {
        playerId: values.playerId,
        note: values.note,
      });
      message.success('已加入白名单');
      onSuccess();
    } catch (e: any) {
      // 拦截器处理
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="加入误报白名单"
      onCancel={onCancel}
      onOk={handleOk}
      okText="确认加入"
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="玩家 ID"
          name="playerId"
          rules={[{ required: true, message: '请输入玩家 ID' }]}
        >
          <Input placeholder="输入需要加入白名单的玩家 ID" />
        </Form.Item>
        <Form.Item label="备注（可选）" name="note">
          <Input.TextArea rows={3} placeholder="填写加入白名单的原因（如：疑似误报、自动化测试等）" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---------- 主页面 ----------

export default function RiskPage() {
  const [dashboard, setDashboard] = useState<RiskDashboard | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [dashLoading, setDashLoading] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [whitelistAddOpen, setWhitelistAddOpen] = useState(false);
  const [current, setCurrent] = useState<RiskCase | null>(null);

  // 用于触发案件表格刷新
  const [caseReloadKey, setCaseReloadKey] = useState(0);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      const res = await client.get('/admin/v1/risk/dashboard');
      const envelope = res?.data ?? res;
      const body = envelope?.code === 0 ? envelope.data : envelope;
      setDashboard({
        top: Array.isArray(body?.top) ? body.top : [],
        pending: typeof body?.pending === 'number' ? body.pending : 0,
      });
    } catch (e: any) {
      setDashError(e?.message || '加载失败');
      setDashboard({ top: [], pending: 0 });
    } finally {
      setDashLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const reloadCases = useCallback(() => {
    setCaseReloadKey((k) => k + 1);
  }, []);

  const openDetail = (r: RiskCase) => {
    setCurrent(r);
    setDetailOpen(true);
  };
  const openDispose = (r: RiskCase) => {
    setCurrent(r);
    setDisposeOpen(true);
  };
  const openLock = (r: RiskCase) => {
    setCurrent(r);
    setLockOpen(true);
  };
  const openRecover = (r: RiskCase) => {
    setCurrent(r);
    setRecoverOpen(true);
  };

  const caseColumns = useMemo<ColumnsType<RiskCase>>(
    () => [
      { title: 'ID', dataIndex: 'id', width: 80 },
      { title: '玩家 ID', dataIndex: 'playerId', width: 100 },
      { title: '类型', dataIndex: 'type', width: 120 },
      { title: '严重程度', dataIndex: 'severity', width: 100 },
      {
        title: '状态',
        dataIndex: 'status',
        width: 100,
        render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
      },
      { title: '创建时间', dataIndex: 'createdAt', width: 180 },
      {
        title: '操作',
        key: 'action',
        width: 320,
        fixed: 'right',
        render: (_: any, r) => (
          <Space size="small">
            <Button size="small" onClick={() => openDetail(r)}>
              详情
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => openDispose(r)}
            >
              处置
            </Button>
            <Button
              size="small"
              danger
              onClick={() => openLock(r)}
            >
              锁定
            </Button>
            <Button
              size="small"
              onClick={() => openRecover(r)}
            >
              回收
            </Button>
          </Space>
        ),
      },
    ],
    [],
  );

  const topColumns = useMemo<ColumnsType<any>>(
    () => [
      { title: '类型/类别', dataIndex: 'type', key: 'type' },
      { title: '数量', dataIndex: 'count', key: 'count', width: 120 },
      { title: '玩家', dataIndex: 'playerId', key: 'playerId', width: 120 },
    ],
    [],
  );

  const caseFetch = () => client.get('/admin/v1/risk/cases');

  const tabItems = [
    {
      key: 'dashboard',
      label: '风控看板',
      children: (
        <div>
          {dashError && (
            <Alert
              type="error"
              message={`加载看板失败: ${dashError}`}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Row gutter={[16, 16]}>
            <Col span={24}>
              <Card
                loading={dashLoading}
                title="待处理案件"
                extra={<Button onClick={loadDashboard}>刷新</Button>}
              >
                <Statistic
                  title="待处理"
                  value={dashboard?.pending ?? 0}
                  valueStyle={{ color: '#cf1322', fontSize: 32 }}
                />
              </Card>
            </Col>

            <Col span={24}>
              <Card title="Top 案件类型" loading={dashLoading}>
                {dashboard?.top && dashboard.top.length > 0 ? (
                  <Table
                    size="small"
                    rowKey={(r: any, i) => r.id ?? `${i}`}
                    columns={topColumns}
                    dataSource={dashboard.top}
                    pagination={false}
                  />
                ) : (
                  <Empty description="暂无数据" />
                )}
              </Card>
            </Col>
          </Row>
        </div>
      ),
    },
    {
      key: 'cases',
      label: '风控案件',
      children: (
        <AdminTable<RiskCase>
          rowKey="id"
          title="风控案件"
          columns={caseColumns}
          fetchFn={caseFetch}
          defaultPageSize={20}
          deps={[caseReloadKey]}
        />
      ),
    },
    {
      key: 'whitelist',
      label: '白名单管理',
      children: (
        <Card
          title="误报白名单"
          extra={
            <Button type="primary" onClick={() => setWhitelistAddOpen(true)}>
              加入白名单
            </Button>
          }
        >
          <Empty
            description={
              <div>
                <p>暂无白名单列表展示接口（后端未提供 GET 端点）</p>
                <p style={{ color: '#bbb', fontSize: 12 }}>
                  使用右上按钮将玩家加入白名单；从案件详情页也可操作。
                </p>
              </div>
            }
          />
        </Card>
      ),
    },
  ];

  return (
    <>
      <Tabs items={tabItems} />

      {/* 详情 Modal（保留现有） */}
      <Modal
        open={detailOpen}
        title="案件详情"
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

      {/* 处置 */}
      <DisposeModal
        open={disposeOpen}
        record={current}
        onCancel={() => setDisposeOpen(false)}
        onSuccess={() => {
          setDisposeOpen(false);
          reloadCases();
        }}
      />

      {/* 锁定 */}
      <LockModal
        open={lockOpen}
        record={current}
        onCancel={() => setLockOpen(false)}
        onSuccess={() => {
          setLockOpen(false);
          reloadCases();
        }}
      />

      {/* 回收 */}
      <RecoverModal
        open={recoverOpen}
        record={current}
        onCancel={() => setRecoverOpen(false)}
        onSuccess={() => {
          setRecoverOpen(false);
          reloadCases();
        }}
      />

      {/* 白名单 */}
      <WhitelistModal
        open={whitelistAddOpen}
        onCancel={() => setWhitelistAddOpen(false)}
        onSuccess={() => {
          setWhitelistAddOpen(false);
          reloadCases();
        }}
      />
    </>
  );
}
