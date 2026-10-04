import { useState } from 'react';
import {
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface Dialogue {
  id: number;
  code: string;
  title: string;
  version: number;
  isActive: boolean;
  nodes?: any;
  createdAt?: string;
  updatedAt?: string;
}

export default function DialoguePage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<Dialogue | null>(null);
  const [form] = Form.useForm();

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchList = (page: number, limit: number) =>
    client.get('/admin/v1/world/dialogue/list', { params: { page, limit } });

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    form.setFieldsValue({
      code: '',
      title: '',
      version: 1,
      isActive: true,
      nodes: JSON.stringify({ key: 'root', text: '', options: [] }, null, 2),
    });
    setCreateOpen(true);
  };

  const openEdit = async (record: Dialogue) => {
    try {
      const res = await client.get(`/admin/v1/world/dialogue/${record.id}`);
      const env = res?.data ?? res;
      const body = env?.code === 0 ? env.data : env;
      setCurrent(body);
      form.setFieldsValue({
        code: body.code,
        title: body.title,
        version: body.version,
        isActive: body.isActive,
        nodes: JSON.stringify(body.nodes || body, null, 2),
      });
      setEditOpen(true);
    } catch {
      // 拦截器已提示
    }
  };

  const openDetail = async (record: Dialogue) => {
    try {
      const res = await client.get(`/admin/v1/world/dialogue/${record.id}`);
      const env = res?.data ?? res;
      const body = env?.code === 0 ? env.data : env;
      setCurrent(body);
      setDetailOpen(true);
    } catch {
      // 拦截器已提示
    }
  };

  const handleDelete = async (record: Dialogue) => {
    try {
      await client.delete(`/admin/v1/world/dialogue/${record.id}`);
      message.success('删除成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const submitForm = async (action: 'create' | 'update') => {
    const values = await form.validateFields();
    let nodes: any = null;
    try {
      nodes = typeof values.nodes === 'string' ? JSON.parse(values.nodes) : values.nodes;
    } catch {
      message.error('nodes JSON 格式错误');
      return;
    }
    const payload = {
      code: values.code,
      title: values.title,
      version: values.version,
      isActive: values.isActive,
      nodes,
    };
    try {
      if (action === 'create') {
        await client.post('/admin/v1/world/dialogue', payload);
        message.success('创建成功');
        setCreateOpen(false);
      } else {
        await client.put(`/admin/v1/world/dialogue/${current?.id}`, payload);
        message.success('更新成功');
        setEditOpen(false);
      }
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const handleToggle = async (record: Dialogue) => {
    try {
      await client.post(`/admin/v1/world/dialogue/${record.id}/toggle`);
      message.success('已切换状态');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<Dialogue> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: 'Code', dataIndex: 'code' },
    { title: '标题', dataIndex: 'title' },
    { title: '版本', dataIndex: 'version', width: 80 },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 100,
      render: (v: boolean) =>
        v ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 260,
      render: (_: any, record: Dialogue) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button
            size="small"
            type={record.isActive ? 'default' : 'primary'}
            danger={record.isActive}
            onClick={() => handleToggle(record)}
          >
            {record.isActive ? '停用' : '启用'}
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
      <Form.Item
        label="Code (对话编码)"
        name="code"
        rules={[{ required: true, message: '请输入对话编码' }]}
      >
        <Input placeholder="如 npc_blacksmith_main" />
      </Form.Item>
      <Form.Item
        label="标题"
        name="title"
        rules={[{ required: true, message: '请输入标题' }]}
      >
        <Input />
      </Form.Item>
      <Form.Item label="版本" name="version">
        <InputNumber min={1} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="启用" name="isActive" valuePropName="checked">
        <Checkbox>启用状态</Checkbox>
      </Form.Item>
      <Form.Item
        label="对话树 (nodes JSON)"
        name="nodes"
        rules={[{ required: true, message: '请输入 nodes JSON' }]}
      >
        <Input.TextArea rows={10} placeholder={'{"key":"root","text":"","options":[]}'} />
      </Form.Item>
    </Form>
  );

  return (
    <>
      <AdminTable<Dialogue>
        rowKey="id"
        title="对话管理"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建对话
          </Button>
        }
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={800}
        title={`对话详情 ${current?.code || ''}`}
      >
        {current && (
          <pre
            style={{
              maxHeight: 520,
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
        title="编辑对话"
        width={600}
        onOk={() => submitForm('update')}
        destroyOnClose
      >
        <FormFields />
      </Modal>

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建对话"
        width={600}
        onOk={() => submitForm('create')}
        destroyOnClose
      >
        <FormFields />
      </Modal>
    </>
  );
}
