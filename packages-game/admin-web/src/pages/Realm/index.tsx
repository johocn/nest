import { useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface RealmTemplate {
  id: number | string;
  name?: string;
  stage?: string;
  levelStart?: number;
  levelEnd?: number;
  levelRange?: string;
  isActive?: boolean;
  updatedAt?: string;
}

export default function RealmPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [current, setCurrent] = useState<RealmTemplate | null>(null);
  const [form] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchList = () => client.get('/admin/v1/realm/templates');

  const del = async (record: RealmTemplate) => {
    try {
      await client.delete(`/admin/v1/realm/templates/${record.id}`);
      message.success('删除成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true });
    setModalOpen(true);
  };

  const openEdit = (record: RealmTemplate) => {
    setCurrent(record);
    form.setFieldsValue({
      ...record,
      levelStart: record.levelStart ?? record.levelRange?.split('-')[0],
      levelEnd: record.levelEnd ?? record.levelRange?.split('-')[1],
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      if (current) {
        await client.put(`/admin/v1/realm/templates/${current.id}`, values);
        message.success('更新成功');
      } else {
        await client.post('/admin/v1/realm/templates', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns = useMemo<ColumnsType<RealmTemplate>>(
    () => [
      { title: 'ID', dataIndex: 'id', width: 80 },
      { title: '名称', dataIndex: 'name' },
      { title: '阶段', dataIndex: 'stage', width: 120 },
      {
        title: '等级范围',
        key: 'levelRange',
        width: 140,
        render: (_: any, r) =>
          r.levelRange || (r.levelStart !== undefined ? `${r.levelStart}-${r.levelEnd ?? ''}` : '-'),
      },
      {
        title: '启用',
        dataIndex: 'isActive',
        width: 100,
        render: (v: boolean) =>
          v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
      },
      { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
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
      <AdminTable<RealmTemplate>
        rowKey="id"
        title="境界模板"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建模板
          </Button>
        }
      />

      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        title={current ? '编辑境界模板' : '新建境界模板'}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="例如：练气期" />
          </Form.Item>
          <Form.Item label="阶段" name="stage">
            <Input placeholder="例如：early / middle / late" />
          </Form.Item>
          <Space style={{ width: '100%' }} align="baseline">
            <Form.Item label="起始等级" name="levelStart">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="结束等级" name="levelEnd">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item label="是否启用" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
