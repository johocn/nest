import { useState } from 'react';
import {
  Button,
  Form,
  Input,
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

interface ExploreTemplate {
  id: number;
  name: string;
  encounterType?: string;
  rarity?: string;
  description?: string;
  isActive?: boolean;
  [k: string]: any;
}

const ENCOUNTER_TYPE_OPTIONS = [
  { value: 'encounter', label: '普通遭遇' },
  { value: 'boss', label: 'Boss' },
  { value: 'treasure', label: '宝藏' },
];

const RARITY_OPTIONS = [
  { value: 'common', label: '普通 common' },
  { value: 'rare', label: '稀有 rare' },
  { value: 'epic', label: '史诗 epic' },
  { value: 'legendary', label: '传说 legendary' },
];

export default function ExplorePage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<ExploreTemplate | null>(null);
  const [form] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  // 后端无分页，不传 page/limit
  const fetchList = () => client.get('/admin/v1/explore/templates');

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, encounterType: 'encounter', rarity: 'common' });
    setCreateOpen(true);
  };

  const openEdit = (record: ExploreTemplate) => {
    setCurrent(record);
    form.setFieldsValue(record);
    setEditOpen(true);
  };

  const openDetail = (record: ExploreTemplate) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const handleDelete = async (record: ExploreTemplate) => {
    try {
      await client.delete(`/admin/v1/explore/templates/${record.id}`);
      message.success('删除成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const submitForm = async (action: 'create' | 'update') => {
    const values = await form.validateFields();
    try {
      if (action === 'create') {
        await client.post('/admin/v1/explore/templates', values);
        message.success('创建成功');
        setCreateOpen(false);
      } else {
        await client.put(`/admin/v1/explore/templates/${current?.id}`, values);
        message.success('更新成功');
        setEditOpen(false);
      }
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<ExploreTemplate> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型',
      dataIndex: 'encounterType',
      width: 140,
      render: (t: string) => <Tag color="blue">{t || '-'}</Tag>,
    },
    {
      title: '稀有度',
      dataIndex: 'rarity',
      width: 140,
      render: (r: string) => {
        const map: Record<string, string> = { common: 'default', rare: 'geekblue', epic: 'purple', legendary: 'gold' };
        return r ? <Tag color={map[r] || 'default'}>{r}</Tag> : '-';
      },
    },
    {
      title: '启用',
      dataIndex: 'isActive',
      width: 100,
      render: (v: boolean) =>
        v == null ? '-' : v ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: ExploreTemplate) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除？"
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

  const FormFields = () => (
    <Form form={form} layout="vertical">
      <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
        <Input />
      </Form.Item>
      <Form.Item label="类型" name="encounterType">
        <Select options={ENCOUNTER_TYPE_OPTIONS} />
      </Form.Item>
      <Form.Item label="稀有度" name="rarity">
        <Select options={RARITY_OPTIONS} />
      </Form.Item>
      <Form.Item label="启用" name="isActive" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="描述" name="description">
        <Input.TextArea rows={4} />
      </Form.Item>
    </Form>
  );

  return (
    <>
      <AdminTable<ExploreTemplate>
        rowKey="id"
        title="奇遇模板"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        defaultPageSize={20}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建模板
          </Button>
        }
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        title={`模板详情 #${current?.id}`}
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
        title="编辑模板"
        onOk={() => submitForm('update')}
        destroyOnClose
      >
        <FormFields />
      </Modal>

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建模板"
        onOk={() => submitForm('create')}
        destroyOnClose
      >
        <FormFields />
      </Modal>
    </>
  );
}
