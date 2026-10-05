import { useState } from 'react';
import { Tabs, Form, Input, InputNumber, Select, Space, Modal, Button, Popconfirm, Tag, message, Empty } from 'antd';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface RechargeProduct {
  id: string;
  name: string;
  amount: string;
  rewardJson: any;
  isHot: boolean;
  sortOrder: number;
  [k: string]: any;
}

interface RechargeOrder {
  id: string;
  orderNo: string;
  playerId: string;
  productId: string;
  amount: string;
  currency: string;
  status: string;
  payMethod: string;
  callbackAt?: string;
  createdAt?: string;
  [k: string]: any;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'orange',
  paid: 'blue',
  delivered: 'green',
  failed: 'red',
  cancelled: 'default',
};

export default function PaymentPage() {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>充值管理</h2>
      <Tabs items={[
        { key: 'products', label: '充值商品', children: <ProductsTab /> },
        { key: 'orders', label: '充值订单', children: <OrdersTab /> },
      ]} />
    </div>
  );
}

// ===== 充值商品 Tab =====
function ProductsTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RechargeProduct | null>(null);
  const [form] = Form.useForm();
  const triggerReload = () => setReloadKey((k) => k + 1);
  const fetchList = () => client.get('/admin/v1/payment/products');

  const openCreate = () => {
    setEditing(null); form.resetFields();
    form.setFieldsValue({ sortOrder: 0, isHot: false, rewardJson: '{\n  "currency": { "gold": 1000 }\n}' });
    setModalOpen(true);
  };
  const openEdit = (r: RechargeProduct) => {
    setEditing(r);
    form.setFieldsValue({
      ...r,
      rewardJson: typeof r.rewardJson === 'string' ? r.rewardJson : JSON.stringify(r.rewardJson ?? {}, null, 2),
    });
    setModalOpen(true);
  };

  const parseJSON = (v: any) => {
    if (v == null || v === '') return {};
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { throw new Error('rewardJson 必须是合法 JSON'); }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values, rewardJson: parseJSON(values.rewardJson) };
      if (editing) { await client.put(`/admin/v1/payment/product/${editing.id}`, payload); message.success('更新成功'); }
      else { await client.post('/admin/v1/payment/product', payload); message.success('创建成功'); }
      setModalOpen(false); triggerReload();
    } catch (e: any) { if (e?.message?.includes('JSON')) message.error(e.message); }
  };

  const handleDelete = async (r: RechargeProduct) => {
    try { await client.delete(`/admin/v1/payment/product/${r.id}`); message.success('已删除'); triggerReload(); } catch { /* intercept */ }
  };

  return (
    <>
      <AdminTable<RechargeProduct>
        rowKey="id" title="充值商品" fetchFn={fetchList} deps={[reloadKey]}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 80, render: (v) => <code>{String(v)}</code> },
          { title: '名称', dataIndex: 'name', width: 180 },
          { title: '金额', dataIndex: 'amount', width: 100, render: (v: string) => `¥${(Number(v) / 100).toFixed(2)}` },
          { title: '奖励', dataIndex: 'rewardJson', render: (r: any) => <code style={{ fontSize: 12 }}>{JSON.stringify(r).slice(0, 60)}{JSON.stringify(r).length > 60 ? '…' : ''}</code> },
          { title: '热门', dataIndex: 'isHot', width: 70, render: (v: boolean) => v ? <Tag color="red">热</Tag> : null },
          { title: '排序', dataIndex: 'sortOrder', width: 80 },
          { title: '操作', key: 'action', width: 180, fixed: 'right', render: (_, r) => (
            <Space size="small">
              <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
              <Popconfirm title="确定软删此商品?" onConfirm={() => handleDelete(r)}><Button type="link" size="small" danger>删除</Button></Popconfirm>
            </Space>
          ) },
        ]}
        extra={<Button type="primary" onClick={openCreate}>新建商品</Button>}
      />
      <Modal title={editing ? `编辑商品: ${editing.name}` : '新建充值商品'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} destroyOnClose width={560}>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}><Input placeholder="如：6 元首充礼包" /></Form.Item>
          <Form.Item label="金额（分）" name="amount" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} placeholder="600 = ¥6.00" /></Form.Item>
          <Form.Item label="奖励 JSON" name="rewardJson" tooltip="支持 currency/exp/vipExp 混用"><Input.TextArea rows={4} placeholder='{"currency":{"gold":1000}}' /></Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item label="排序" name="sortOrder" style={{ width: 160 }}><InputNumber style={{ width: '100%' }} /></Form.Item>
            <Form.Item label="热门" name="isHot" valuePropName="checked" style={{ width: 160 }}><Select options={[{ label: '否', value: false }, { label: '是', value: true }]} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}

// ===== 充值订单 Tab =====
function OrdersTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const triggerReload = () => setReloadKey((k) => k + 1);
  const fetchList = () => client.get('/admin/v1/payment/orders');

  const handleDeliver = async (r: RechargeOrder) => {
    try { await client.post(`/admin/v1/payment/orders/${r.id}/deliver`, { adminId: 'admin' }); message.success('手动发货成功'); triggerReload(); } catch { /* intercept */ }
  };

  const renderDetail = (_: any, r: RechargeOrder) => (
    <Space size="small">
      <Button type="link" size="small" onClick={() => Modal.info({ title: `订单详情 #${r.id}`, content: <pre style={{ fontSize: 12 }}>{JSON.stringify(r, null, 2)}</pre>, width: 560 })}>详情</Button>
      {r.status !== 'delivered' && (
        <Popconfirm title="手动发货（已支付但未到账的订单补发）" onConfirm={() => handleDeliver(r)}>
          <Button type="link" size="small">发货</Button>
        </Popconfirm>
      )}
    </Space>
  );

  return (
    <AdminTable<RechargeOrder>
      rowKey="id" title="充值订单" fetchFn={fetchList} deps={[reloadKey]} defaultPageSize={20}
      columns={[
        { title: '订单号', dataIndex: 'orderNo', width: 180, render: (v: string) => <code>{v}</code> },
        { title: '玩家', dataIndex: 'playerId', width: 100 },
        { title: '商品', dataIndex: 'productId', width: 100 },
        { title: '金额', dataIndex: 'amount', width: 100, render: (v: string, r) => `${r.currency ?? 'CNY'} ${(Number(v) / 100).toFixed(2)}` },
        { title: '支付方式', dataIndex: 'payMethod', width: 100 },
        { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={STATUS_COLORS[v] ?? 'default'}>{v}</Tag> },
        { title: '创建时间', dataIndex: 'createdAt', width: 170 },
        { title: '操作', key: 'action', width: 150, fixed: 'right', render: renderDetail },
      ]}
    />
  );
}
