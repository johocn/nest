import { useState } from 'react';
import {
  Button,
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
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface VipConfig {
  level: number;
  name: string;
  requiredExp?: number;
  benefits?: any;
  multiplier?: number;
  isActive?: boolean;
  [k: string]: any;
}

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
    return v;
  }
}

export default function VipPage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<VipConfig | null>(null);
  const [form] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  // 后端 probe 显示返回 raw array，useAdminTable 中 Array.isArray 分支可正确处理
  const fetchList = () => client.get('/admin/v1/vip/config/list');

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({
      isActive: true,
      multiplier: 1,
      benefits: '{}',
    });
    setCreateOpen(true);
  };

  const openEdit = (record: VipConfig) => {
    setCurrent(record);
    form.setFieldsValue({
      ...record,
      benefits: safeJsonStringify(record.benefits),
    });
    setEditOpen(true);
  };

  const openDetail = (record: VipConfig) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const handleDelete = async (record: VipConfig) => {
    try {
      await client.delete(`/admin/v1/vip/config/${record.level}`);
      message.success('删除成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const submitCreate = async () => {
    const values = await form.validateFields();
    const payload = { ...values, benefits: tryParseJson(values.benefits, {}) };
    try {
      await client.post('/admin/v1/vip/config', payload);
      message.success('创建成功');
      setCreateOpen(false);
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const submitUpdate = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      level: undefined, // 编辑时 level 不走 body
      benefits: tryParseJson(values.benefits, {}),
    };
    // ⚠️ Backend uses @Patch for VIP update — only exception to our no-PATCH rule
    try {
      await client.patch(`/admin/v1/vip/config/${current?.level}`, payload);
      message.success('更新成功');
      setEditOpen(false);
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<VipConfig> = [
    { title: '等级', dataIndex: 'level', width: 80, sorter: (a, b) => a.level - b.level },
    { title: '名称', dataIndex: 'name' },
    { title: '所需经验', dataIndex: 'requiredExp', width: 110 },
    {
      title: '倍率',
      dataIndex: 'multiplier',
      width: 90,
      render: (v: number) => (v != null ? `×${v}` : '-'),
    },
    {
      title: '权益',
      dataIndex: 'benefits',
      ellipsis: true,
      render: (b: any) => {
        if (!b) return '-';
        const text = typeof b === 'string' ? b : JSON.stringify(b);
        return (
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {text.length > 60 ? text.slice(0, 60) + '…' : text}
          </span>
        );
      },
    },
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
      width: 220,
      render: (_: any, record: VipConfig) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除 VIP Lv.${record.level}？`}
            onConfirm={() => handleDelete(record)}
            okText="确认"
            cancelText="取消"
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const CreateForm = () => (
    <Form form={form} layout="vertical" preserve={false}>
      <Form.Item
        label="VIP 等级"
        name="level"
        rules={[{ required: true, message: '请输入等级' }]}
      >
        <InputNumber min={1} style={{ width: '100%' }} placeholder="如：1" />
      </Form.Item>
      <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
        <Input placeholder="如：青铜 VIP" />
      </Form.Item>
      <Space style={{ width: '100%' }} size="middle">
        <Form.Item label="所需经验" name="requiredExp" style={{ width: 180 }}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="倍率"
          name="multiplier"
          rules={[{ required: true, message: '请输入倍率' }]}
          style={{ width: 140 }}
        >
          <InputNumber min={0} step={0.1} style={{ width: '100%' }} placeholder="1" />
        </Form.Item>
        <Form.Item label="启用" name="isActive" style={{ width: 100 }}>
          <Select
            options={[
              { value: true, label: '启用' },
              { value: false, label: '禁用' },
            ]}
          />
        </Form.Item>
      </Space>
      <Form.Item
        label="权益 (benefits)"
        name="benefits"
        tooltip='JSON 对象，如 {"dailyGold":100}'
      >
        <Input.TextArea rows={5} placeholder='{"dailyGold":100,"exclusiveEmojis":["vip"]}' />
      </Form.Item>
    </Form>
  );

  const EditForm = () => (
    <Form form={form} layout="vertical" preserve={false}>
      <Form.Item label="VIP 等级">
        <Input value={current?.level} disabled />
      </Form.Item>
      <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
        <Input placeholder="如：青铜 VIP" />
      </Form.Item>
      <Space style={{ width: '100%' }} size="middle">
        <Form.Item label="所需经验" name="requiredExp" style={{ width: 180 }}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="倍率"
          name="multiplier"
          rules={[{ required: true, message: '请输入倍率' }]}
          style={{ width: 140 }}
        >
          <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="启用" name="isActive" style={{ width: 100 }}>
          <Select
            options={[
              { value: true, label: '启用' },
              { value: false, label: '禁用' },
            ]}
          />
        </Form.Item>
      </Space>
      <Form.Item label="权益 (benefits)" name="benefits" tooltip="JSON 对象">
        <Input.TextArea rows={5} placeholder='{"dailyGold":100}' />
      </Form.Item>
    </Form>
  );

  return (
    <>
      <AdminTable<VipConfig>
        rowKey="level"
        title="VIP 配置"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        defaultPageSize={20}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建 VIP 等级
          </Button>
        }
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        title={`VIP 详情 Lv.${current?.level}`}
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

      <Modal
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        title={`编辑 VIP Lv.${current?.level}`}
        onOk={submitUpdate}
        destroyOnClose
        width={640}
      >
        <EditForm />
      </Modal>

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建 VIP 等级"
        onOk={submitCreate}
        destroyOnClose
        width={640}
      >
        <CreateForm />
      </Modal>
    </>
  );
}
