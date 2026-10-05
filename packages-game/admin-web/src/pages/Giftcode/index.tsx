import { useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface GiftTemplate {
  id: string;
  name: string;
  description?: string;
  generateType: string;
  prefix?: string | null;
  rewards: any;
  validSeconds: number;
  claimLimit: string;
  totalLimit: number;
  claimedCount: number;
  enabled: boolean;
  createdAt: string;
  [k: string]: any;
}

const GENERATE_TYPE_OPTIONS = [
  { value: 'batch', label: '批量（随机码）' },
  { value: 'pattern', label: '规则（前缀+随机）' },
  { value: 'custom', label: '自定义（固定码）' },
];

const CLAIM_LIMIT_OPTIONS = [
  { value: 'one_per_player', label: '每玩家一次' },
  { value: 'unlimited', label: '不限次数' },
  { value: 'once_per_day', label: '每日一次' },
];

const DEFAULT_VALID_SECONDS = 60 * 60 * 24 * 7; // 7 天

export default function GiftcodePage() {
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<GiftTemplate | null>(null);
  const [form] = Form.useForm();
  const [genForm] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchList = () => client.get('/admin/v1/giftcode/templates');

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({
      generateType: 'batch',
      claimLimit: 'one_per_player',
      validSeconds: DEFAULT_VALID_SECONDS,
      totalLimit: 0,
      enabled: true,
      rewards: '{\n  "currency": { "gold": 1000 }\n}',
    });
    setCreateOpen(true);
  };

  const openEdit = (record: GiftTemplate) => {
    setCurrent(record);
    const rewardsStr =
      typeof record.rewards === 'string'
        ? record.rewards
        : record.rewards != null
          ? JSON.stringify(record.rewards, null, 2)
          : '';
    form.setFieldsValue({ ...record, rewards: rewardsStr });
    setEditOpen(true);
  };

  const openGenerate = (record: GiftTemplate) => {
    setCurrent(record);
    genForm.resetFields();
    genForm.setFieldsValue({ count: 100 });
    setGenerateOpen(true);
  };

  const parseJSON = (v: any) => {
    if (v == null || v === '') return undefined;
    if (typeof v === 'object') return v;
    try {
      return JSON.parse(v);
    } catch {
      throw new Error('rewards JSON 格式不正确');
    }
  };

  const submitForm = async (action: 'create' | 'update') => {
    const values = await form.validateFields();
    try {
      const payload = {
        ...values,
        rewards: parseJSON(values.rewards),
      };
      if (action === 'create') {
        await client.post('/admin/v1/giftcode/templates', payload);
        message.success('模板创建成功');
        setCreateOpen(false);
      } else {
        await client.post(`/admin/v1/giftcode/templates/${current?.id}`, payload);
        message.success('模板更新成功');
        setEditOpen(false);
      }
      triggerReload();
    } catch (e: any) {
      if (e?.message?.includes('JSON')) message.error(e.message);
    }
  };

  const submitGenerate = async () => {
    const values = await genForm.validateFields();
    try {
      await client.post(`/admin/v1/giftcode/templates/${current?.id}/generate`, values);
      message.success(`生成 ${values.count} 个兑换码成功`);
      setGenerateOpen(false);
    } catch {
      // 拦截器已提示
    }
  };

  const handleDelete = async (record: GiftTemplate) => {
    try {
      await client.delete(`/admin/v1/giftcode/templates/${record.id}`);
      message.success('已删除');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<GiftTemplate> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '生成方式',
      dataIndex: 'generateType',
      width: 120,
      render: (t: string) => {
        const o = GENERATE_TYPE_OPTIONS.find((x) => x.value === t);
        return <Tag>{o?.label || t}</Tag>;
      },
    },
    { title: '前缀', dataIndex: 'prefix', width: 140, render: (v: any) => v || '-' },
    {
      title: '奖励',
      dataIndex: 'rewards',
      render: (r: any) => {
        if (!r) return '-';
        const str = typeof r === 'string' ? r : JSON.stringify(r);
        return (
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {str.slice(0, 50)}
            {str.length > 50 ? '…' : ''}
          </span>
        );
      },
    },
    {
      title: '有效期',
      dataIndex: 'validSeconds',
      width: 100,
      render: (s: number) => `${Math.round(s / 86400)}天`,
    },
    {
      title: '领取限制',
      dataIndex: 'claimLimit',
      width: 110,
      render: (c: string) => {
        const o = CLAIM_LIMIT_OPTIONS.find((x) => x.value === c);
        return <Tag>{o?.label || c}</Tag>;
      },
    },
    { title: '总限额', dataIndex: 'totalLimit', width: 80, render: (v: number) => v || '不限' },
    { title: '已兑换', dataIndex: 'claimedCount', width: 80 },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_: any, record: GiftTemplate) => (
        <Space>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Button size="small" type="primary" onClick={() => openGenerate(record)}>生成码</Button>
          <Button size="small" danger onClick={() => handleDelete(record)}>删除</Button>
        </Space>
      ),
    },
  ];

  const FormFields = () => (
    <Form form={form} layout="vertical">
      <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入模板名称' }]}>
        <Input placeholder="如：新玩家欢迎礼包" />
      </Form.Item>
      <Form.Item label="描述" name="description">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item label="生成方式" name="generateType" rules={[{ required: true }]}>
        <Select options={GENERATE_TYPE_OPTIONS} />
      </Form.Item>
      <Form.Item label="前缀（规则生成时生效）" name="prefix">
        <Input placeholder="如 WELCOME2025-" />
      </Form.Item>
      <Form.Item label="奖励 (JSON)" name="rewards" rules={[{ required: true }]} tooltip="支持 items + currency + exp + vipExp 混用">
        <Input.TextArea
          rows={5}
          placeholder={'{\n  "currency": { "gold": 1000, "gem": 100 },\n  "exp": 5000\n}'}
        />
      </Form.Item>
      <Form.Item label="有效期（秒）" name="validSeconds">
        <InputNumber min={60} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="领取限制" name="claimLimit" rules={[{ required: true }]}>
        <Select options={CLAIM_LIMIT_OPTIONS} />
      </Form.Item>
      <Form.Item label="总限额（0=不限）" name="totalLimit">
        <InputNumber min={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="启用" name="enabled" valuePropName="checked">
        <Switch />
      </Form.Item>
    </Form>
  );

  return (
    <>
      <AdminTable<GiftTemplate>
        rowKey="id"
        title="礼包码模板"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        defaultPageSize={20}
        scroll={{ x: 1200 }}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建模板
          </Button>
        }
      />

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建礼包模板"
        onOk={() => submitForm('create')}
        destroyOnClose
        width={560}
      >
        <FormFields />
      </Modal>

      <Modal
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        title={`编辑模板 #${current?.id}`}
        onOk={() => submitForm('update')}
        destroyOnClose
        width={560}
      >
        <FormFields />
      </Modal>

      <Modal
        open={generateOpen}
        onCancel={() => setGenerateOpen(false)}
        title={`为模板「${current?.name}」生成兑换码`}
        onOk={submitGenerate}
        destroyOnClose
      >
        <Form form={genForm} layout="vertical">
          <Form.Item
            label="生成数量"
            name="count"
            rules={[{ required: true, message: '请输入数量' }]}
          >
            <InputNumber min={1} max={100000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="过期时间（可选）" name="expiresAt">
            <Input type="datetime-local" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
