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
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface BuildingTemplate {
  id: number;
  name: string;
  category: string;
  maxHp: number;
  isActive: boolean;
  updatedAt?: string;
}

export default function BuildingPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [isActive, setIsActive] = useState<boolean | undefined>(undefined);

  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [current, setCurrent] = useState<BuildingTemplate | null>(null);
  const [form] = Form.useForm();

  const fetchList = (page: number, limit: number) => {
    const params: any = { page, limit };
    if (category !== undefined && category !== '') params.category = category;
    if (isActive !== undefined) params.isActive = isActive;
    return client.get('/admin/v1/world/building-templates', { params });
  };

  const triggerReload = () => setReloadKey((k) => k + 1);

  const toggle = async (record: BuildingTemplate) => {
    try {
      await client.post(`/admin/v1/world/building-templates/${record.id}/toggle`);
      message.success('已切换启停');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const del = async (record: BuildingTemplate) => {
    try {
      await client.delete(`/admin/v1/world/building-templates/${record.id}`);
      message.success('删除成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const openEdit = (record: BuildingTemplate) => {
    setCurrent(record);
    form.setFieldsValue(record);
    setEditOpen(true);
  };

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    setCreateOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      if (current) {
        await client.put(`/admin/v1/world/building-templates/${current.id}`, values);
        message.success('更新成功');
        setEditOpen(false);
      } else {
        await client.post('/admin/v1/world/building-templates', values);
        message.success('创建成功');
        setCreateOpen(false);
      }
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns = useMemo<ColumnsType<BuildingTemplate>>(
    () => [
      { title: 'ID', dataIndex: 'id', width: 80 },
      { title: '名称', dataIndex: 'name' },
      { title: '分类', dataIndex: 'category', width: 140 },
      { title: '最大 HP', dataIndex: 'maxHp', width: 120 },
      {
        title: '状态',
        dataIndex: 'isActive',
        width: 100,
        render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>),
      },
      { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
      {
        title: '操作',
        key: 'action',
        width: 260,
        render: (_: any, r) => (
          <Space>
            <Button size="small" onClick={() => toggle(r)}>
              {r.isActive ? '停用' : '启用'}
            </Button>
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
      <AdminTable<BuildingTemplate>
        rowKey="id"
        title="建筑蓝图"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey, category, isActive]}
        extra={
          <Space>
            <Select
              allowClear
              placeholder="分类"
              style={{ width: 140 }}
              value={category}
              onChange={(v) => setCategory(v)}
              options={[
                { label: '住宅', value: 'residential' },
                { label: '商用', value: 'commercial' },
                { label: '防御', value: 'defense' },
                { label: '资源', value: 'resource' },
              ]}
            />
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 120 }}
              value={isActive}
              onChange={(v) => setIsActive(v)}
              options={[
                { label: '启用', value: true },
                { label: '停用', value: false },
              ]}
            />
            <Button type="primary" onClick={openCreate}>
              新建蓝图
            </Button>
          </Space>
        }
      />

      <Modal
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        title="编辑蓝图"
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="分类" name="category">
            <Input placeholder="例如 residential / defense" />
          </Form.Item>
          <Form.Item label="最大 HP" name="maxHp">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建蓝图"
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="分类" name="category">
            <Input placeholder="例如 residential / defense" />
          </Form.Item>
          <Form.Item label="最大 HP" name="maxHp">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
