import { useState } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface ActivityTemplate {
  id: number;
  name: string;
  activityType?: string;
  status?: 'draft' | 'published' | 'gray' | 'rolling' | 'ended' | string;
  startTime?: string;
  endTime?: string;
  priority?: number;
  isActive?: boolean;
  rules?: any;
  conditions?: any;
  rewards?: any;
  [k: string]: any;
}

const ACTIVITY_TYPE_OPTIONS = [
  { value: 'login_reward', label: '登录奖励' },
  { value: 'first_recharge', label: '首充礼包' },
  { value: 'limited_shop', label: '限时商店' },
  { value: 'rank_activity', label: '排行榜活动' },
  { value: 'collect_card', label: '集卡活动' },
  { value: 'new_year', label: '节日活动' },
  { value: 'other', label: '其他' },
];

const STATUS_COLOR_MAP: Record<string, string> = {
  draft: 'default',
  published: 'green',
  gray: 'orange',
  rolling: 'blue',
  ended: 'red',
};

const STATUS_LABEL_MAP: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  gray: '灰度中',
  rolling: '进行中',
  ended: '已结束',
};

function safeJsonStringify(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function tryParseJson(v: any, fallback: any = {}): any {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed);
  } catch {
    return v; // 保留原字符串
  }
}

export default function ActivityPage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<ActivityTemplate | null>(null);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [form] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchList = () => client.get('/admin/v1/activity/template/list');

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({
      isActive: true,
      activityType: 'login_reward',
      priority: 0,
      rules: '{}',
      conditions: '{}',
      rewards: '{}',
    });
    setCreateOpen(true);
  };

  const openEdit = (record: ActivityTemplate) => {
    setCurrent(record);
    form.setFieldsValue({
      ...record,
      rules: safeJsonStringify(record.rules),
      conditions: safeJsonStringify(record.conditions),
      rewards: safeJsonStringify(record.rewards),
      // startTime/endTime 如果是 dayjs 对象会被 DatePicker 识别
      startTime: record.startTime,
      endTime: record.endTime,
    });
    setEditOpen(true);
  };

  const openDetail = (record: ActivityTemplate) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const openDashboard = async (record: ActivityTemplate) => {
    setCurrent(record);
    setDashboardOpen(true);
    try {
      const r = await client.get(`/admin/v1/activity/${record.id}/dashboard`);
      setDashboardData(r.data?.data ?? r.data);
    } catch {
      setDashboardData(null);
    }
  };

  const submitForm = async (action: 'create' | 'update') => {
    const values = await form.validateFields();
    // Dayjs -> string
    if (values.startTime && typeof values.startTime.format === 'function') {
      values.startTime = values.startTime.format('YYYY-MM-DD HH:mm:ss');
    }
    if (values.endTime && typeof values.endTime.format === 'function') {
      values.endTime = values.endTime.format('YYYY-MM-DD HH:mm:ss');
    }
    // JSON textarea -> object
    values.rules = tryParseJson(values.rules, {});
    values.conditions = tryParseJson(values.conditions, {});
    values.rewards = tryParseJson(values.rewards, {});

    try {
      if (action === 'create') {
        await client.post('/admin/v1/activity/template', values);
        message.success('创建成功');
        setCreateOpen(false);
      } else {
        await client.put(`/admin/v1/activity/template/${current?.id}`, values);
        message.success('更新成功');
        setEditOpen(false);
      }
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const doPublish = async (record: ActivityTemplate) => {
    try {
      await client.post(`/admin/v1/activity/${record.id}/publish`);
      message.success('发布成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const doGrayVerify = async (record: ActivityTemplate) => {
    try {
      await client.post(`/admin/v1/activity/${record.id}/gray-verify`);
      message.success('灰度验证已发起');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const doRollback = async (record: ActivityTemplate) => {
    try {
      await client.post(`/admin/v1/activity/${record.id}/rollback`);
      message.success('回滚成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<ActivityTemplate> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型',
      dataIndex: 'activityType',
      width: 130,
      render: (t: string) => <Tag color="blue">{t || '-'}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: string) => {
        if (!s) return '-';
        const color = STATUS_COLOR_MAP[s] ?? 'default';
        const label = STATUS_LABEL_MAP[s] ?? s;
        return <Tag color={color}>{label}</Tag>;
      },
    },
    { title: '开始时间', dataIndex: 'startTime', width: 170 },
    { title: '结束时间', dataIndex: 'endTime', width: 170 },
    { title: '优先级', dataIndex: 'priority', width: 90 },
    {
      title: '启用',
      dataIndex: 'isActive',
      width: 90,
      render: (v: boolean) =>
        v == null ? '-' : v ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 260,
      render: (_: any, record: ActivityTemplate) => (
        <Space size="small" wrap>
          <Button size="small" onClick={() => openDashboard(record)}>
            详情
          </Button>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认发布此活动？"
            onConfirm={() => doPublish(record)}
            okText="确认"
            cancelText="取消"
          >
            <Button size="small" type="primary">发布</Button>
          </Popconfirm>
          <Popconfirm
            title="确认发起灰度验证？"
            onConfirm={() => doGrayVerify(record)}
            okText="确认"
            cancelText="取消"
          >
            <Button size="small">灰度</Button>
          </Popconfirm>
          <Popconfirm
            title="确认回滚此活动？"
            onConfirm={() => doRollback(record)}
            okText="确认"
            cancelText="取消"
          >
            <Button size="small" danger>回滚</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const FormFields = () => (
    <Form form={form} layout="vertical" preserve={false}>
      <Form.Item
        label="活动名称"
        name="name"
        rules={[{ required: true, message: '请输入活动名称' }]}
      >
        <Input placeholder="如：春节限时活动" />
      </Form.Item>

      <Space style={{ width: '100%' }} size="middle">
        <Form.Item
          label="活动类型"
          name="activityType"
          rules={[{ required: true, message: '请选择活动类型' }]}
          style={{ width: 200 }}
        >
          <Select options={ACTIVITY_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item label="优先级" name="priority" style={{ width: 140 }}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="启用"
          name="isActive"
          valuePropName="checked"
          style={{ width: 100 }}
        >
          <Select
            options={[
              { value: true, label: '启用' },
              { value: false, label: '禁用' },
            ]}
          />
        </Form.Item>
      </Space>

      <Space style={{ width: '100%' }} size="middle">
        <Form.Item label="开始时间" name="startTime" style={{ width: 260 }}>
          <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm:ss" />
        </Form.Item>
        <Form.Item label="结束时间" name="endTime" style={{ width: 260 }}>
          <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm:ss" />
        </Form.Item>
      </Space>

      <Form.Item label="规则 (rules)" name="rules" tooltip="JSON 对象">
        <Input.TextArea rows={4} placeholder='{"dailyLimit":1}' />
      </Form.Item>
      <Form.Item label="条件 (conditions)" name="conditions" tooltip="JSON 对象">
        <Input.TextArea rows={4} placeholder='{"minLevel":1}' />
      </Form.Item>
      <Form.Item label="奖励 (rewards)" name="rewards" tooltip="JSON 对象/数组">
        <Input.TextArea rows={4} placeholder='[{"itemId":"1001","count":1}]' />
      </Form.Item>
    </Form>
  );

  return (
    <>
      <AdminTable<ActivityTemplate>
        rowKey="id"
        title="活动管理"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        defaultPageSize={20}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建活动
          </Button>
        }
      />

      {/* 基础详情 JSON */}
      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        title={`活动详情 #${current?.id}`}
      >
        {current && (
          <pre
            style={{
              maxHeight: 500,
              overflow: 'auto',
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 4,
              margin: 0,
              fontSize: 12,
            }}
          >
            {JSON.stringify(current, null, 2)}
          </pre>
        )}
      </Modal>

      {/* Dashboard 数据 */}
      <Modal
        open={dashboardOpen}
        onCancel={() => setDashboardOpen(false)}
        footer={null}
        width={720}
        title={`活动仪表盘 #${current?.id}`}
      >
        {dashboardData ? (
          <pre
            style={{
              maxHeight: 500,
              overflow: 'auto',
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 4,
              margin: 0,
              fontSize: 12,
            }}
          >
            {JSON.stringify(dashboardData, null, 2)}
          </pre>
        ) : (
          <div style={{ color: '#999' }}>加载中或无数据…</div>
        )}
      </Modal>

      <Modal
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        title="编辑活动"
        onOk={() => submitForm('update')}
        destroyOnClose
        width={640}
      >
        <FormFields />
      </Modal>

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建活动"
        onOk={() => submitForm('create')}
        destroyOnClose
        width={640}
      >
        <FormFields />
      </Modal>
    </>
  );
}
