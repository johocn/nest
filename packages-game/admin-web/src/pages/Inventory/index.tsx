import { useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface ItemTemplate {
  id: number | string;
  name?: string;
  itemType?: string;
  rarity?: string;
  maxStack?: number;
  sellPrice?: number;
  canTrade?: boolean;
  canDrop?: boolean;
  bindType?: string;
  description?: string;
  configJson?: any;
  createdAt?: string;
}

const ITEM_TYPE_OPTIONS = [
  { label: '材料', value: 'material' },
  { label: '消耗品', value: 'consumable' },
  { label: '装备', value: 'equipment' },
  { label: '代币', value: 'token' },
];

const RARITY_OPTIONS = [
  { label: '普通', value: 'common' },
  { label: '稀有', value: 'rare' },
  { label: '史诗', value: 'epic' },
  { label: '传说', value: 'legendary' },
];

export default function InventoryPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [current, setCurrent] = useState<ItemTemplate | null>(null);
  const [form] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchList = (page: number, limit: number) =>
    client.get('/admin/v1/inventory/item-template', { params: { page, limit } });

  const del = async (record: ItemTemplate) => {
    try {
      await client.delete(`/admin/v1/inventory/item-template/${record.id}`);
      message.success('删除成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({ canTrade: true, canDrop: true, bindType: 'none' });
    setModalOpen(true);
  };

  const openEdit = (record: ItemTemplate) => {
    setCurrent(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      if (current) {
        await client.put(`/admin/v1/inventory/item-template/${current.id}`, values);
        message.success('更新成功');
      } else {
        await client.post('/admin/v1/inventory/item-template', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns = useMemo<ColumnsType<ItemTemplate>>(
    () => [
      { title: 'ID', dataIndex: 'id', width: 80 },
      { title: '名称', dataIndex: 'name' },
      {
        title: '类型',
        dataIndex: 'itemType',
        width: 100,
        render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
      },
      {
        title: '稀有度',
        dataIndex: 'rarity',
        width: 100,
        render: (v: string) => {
          const color = v === 'legendary' ? 'gold' : v === 'epic' ? 'purple' : v === 'rare' ? 'blue' : undefined;
          return v ? <Tag color={color}>{v}</Tag> : '-';
        },
      },
      { title: '最大堆叠', dataIndex: 'maxStack', width: 100 },
      {
        title: '售价',
        dataIndex: 'sellPrice',
        width: 100,
        render: (v: number) => `${v ?? 0} 金`,
      },
      {
        title: '可交易',
        dataIndex: 'canTrade',
        width: 80,
        render: (v: boolean) => (v ? '是' : '否'),
      },
      { title: '创建时间', dataIndex: 'createdAt', width: 180 },
      {
        title: '操作',
        key: 'action',
        width: 180,
        render: (_: any, r) => (
          <Space>
            <Button size="small" onClick={() => openEdit(r)}>
              编辑
            </Button>
            <Popconfirm title="确认删除？" onConfirm={() => del(r)}>
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      <AdminTable<ItemTemplate>
        rowKey="id"
        title="物品模板"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建物品
          </Button>
        }
      />

      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        title={current ? '编辑物品模板' : '新建物品模板'}
        onOk={handleSubmit}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space style={{ width: '100%' }} align="baseline">
            <Form.Item label="类型" name="itemType" rules={[{ required: true }]}>
              <Select options={ITEM_TYPE_OPTIONS} style={{ width: 160 }} placeholder="选择类型" />
            </Form.Item>
            <Form.Item label="稀有度" name="rarity" rules={[{ required: true }]}>
              <Select options={RARITY_OPTIONS} style={{ width: 140 }} placeholder="选择稀有度" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} align="baseline">
            <Form.Item label="最大堆叠" name="maxStack">
              <InputNumber min={1} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item label="售价" name="sellPrice">
              <InputNumber min={0} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item label="绑定类型" name="bindType">
              <Select
                style={{ width: 140 }}
                placeholder="绑定类型"
                options={[
                  { label: '不绑定', value: 'none' },
                  { label: '拾取绑定', value: 'pickup' },
                  { label: '装备绑定', value: 'equip' },
                  { label: '账号绑定', value: 'account' },
                ]}
              />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} align="baseline">
            <Form.Item label="可交易" name="canTrade" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="可掉落" name="canDrop" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
