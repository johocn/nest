import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminTable from '../../components/AdminTable';
import client from '../../api/client';

interface Scene {
  id: number;
  name: string;
  type: string;
  posX?: number;
  posY?: number;
  radius?: number;
  description?: string;
  updatedAt?: string;
}

// 详情里懒加载后端数据的小组件
function AsyncContent({ fetcher, emptyText }: { fetcher: () => Promise<any>; emptyText?: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    fetcher()
      .then((res: any) => {
        const env = res?.data ?? res;
        setData(env?.code === 0 ? env.data : env);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <pre
      style={{
        maxHeight: 400,
        overflow: 'auto',
        background: '#f5f5f5',
        padding: 12,
        borderRadius: 4,
        margin: 0,
      }}
    >
      {loading ? '加载中...' : data ? JSON.stringify(data, null, 2) : emptyText || '无数据'}
    </pre>
  );
}

function SceneForm({ form }: { form: any }) {
  return (
    <Form form={form} layout="vertical">
      <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入场景名称' }]}>
        <Input />
      </Form.Item>
      <Form.Item label="类型" name="type" rules={[{ required: true, message: '请输入类型' }]}>
        <Input placeholder="例如 dungeon / field / city" />
      </Form.Item>
      <Form.Item label="坐标 X" name="posX">
        <InputNumber style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="坐标 Y" name="posY">
        <InputNumber style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="半径" name="radius">
        <InputNumber style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="描述" name="description">
        <Input.TextArea rows={3} />
      </Form.Item>
    </Form>
  );
}

export default function ScenePage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<Scene | null>(null);
  const [form] = Form.useForm();

  const fetchList = (page: number, limit: number) =>
    client.get('/admin/v1/world/scene/list', { params: { page, limit } });

  const fetchSpawns = (id: number) => client.get(`/admin/v1/world/scene/${id}/spawns`);
  const fetchTriggers = (id: number) => client.get(`/admin/v1/world/scene/${id}/triggers`);

  const triggerReload = () => setReloadKey((k) => k + 1);

  const openCreate = () => {
    setCurrent(null);
    form.resetFields();
    setCreateOpen(true);
  };

  const openEdit = (record: Scene) => {
    setCurrent(record);
    form.setFieldsValue(record);
    setEditOpen(true);
  };

  const openDetail = (record: Scene) => {
    setCurrent(record);
    setDetailOpen(true);
  };

  const handleDelete = async (record: Scene) => {
    try {
      await client.delete(`/admin/v1/world/scene/${record.id}`);
      message.success('删除成功');
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      await client.post('/admin/v1/world/scene', values);
      message.success('创建成功');
      setCreateOpen(false);
      form.resetFields();
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const handleEdit = async () => {
    const values = await form.validateFields();
    try {
      await client.put(`/admin/v1/world/scene/${current?.id}`, values);
      message.success('更新成功');
      setEditOpen(false);
      triggerReload();
    } catch {
      // 拦截器已提示
    }
  };

  const columns: ColumnsType<Scene> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型',
      dataIndex: 'type',
      render: (t) => <Tag color="blue">{t}</Tag>,
    },
    { title: '坐标 X', dataIndex: 'posX', width: 100 },
    { title: '坐标 Y', dataIndex: 'posY', width: 100 },
    { title: '半径', dataIndex: 'radius', width: 80 },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 240,
      render: (_: any, record: Scene) => (
        <Space>
          <Button size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该场景？"
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

  return (
    <>
      <AdminTable<Scene>
        rowKey="id"
        title="场景管理"
        columns={columns}
        fetchFn={fetchList}
        deps={[reloadKey]}
        extra={
          <Button type="primary" onClick={openCreate}>
            新建场景
          </Button>
        }
      />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        title={`场景详情 #${current?.id} - ${current?.name}`}
      >
        {current && (
          <Tabs
            items={[
              {
                key: 'base',
                label: '基本信息',
                children: (
                  <pre
                    style={{
                      maxHeight: 400,
                      overflow: 'auto',
                      background: '#f5f5f5',
                      padding: 12,
                      borderRadius: 4,
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(current, null, 2)}
                  </pre>
                ),
              },
              {
                key: 'spawns',
                label: '刷怪点',
                children: <AsyncContent fetcher={() => fetchSpawns(current.id)} emptyText="无刷怪点" />,
              },
              {
                key: 'triggers',
                label: '触发器',
                children: <AsyncContent fetcher={() => fetchTriggers(current.id)} emptyText="无触发器" />,
              },
            ]}
          />
        )}
      </Modal>

      <Modal open={editOpen} onCancel={() => setEditOpen(false)} title="编辑场景" onOk={handleEdit} destroyOnClose>
        <SceneForm form={form} />
      </Modal>

      <Modal open={createOpen} onCancel={() => setCreateOpen(false)} title="新建场景" onOk={handleCreate} destroyOnClose>
        <SceneForm form={form} />
      </Modal>
    </>
  );
}
