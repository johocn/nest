import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
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

interface SceneVersion {
  id: number;
  sceneId: number;
  version: number;
  hash: string;
  filePath: string;
  status: string;
  publishedAt?: string;
  createdAt?: string;
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

function VersionTab({ sceneId }: { sceneId: number }) {
  const [versions, setVersions] = useState<SceneVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [targetVersion, setTargetVersion] = useState<number | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  const loadVersions = async () => {
    setLoading(true);
    try {
      const res = await client.get(`/admin/v1/world/scene-config/${sceneId}/versions`);
      const env = res?.data ?? res;
      const body = env?.code === 0 ? env.data : env;
      const list: SceneVersion[] = body?.items ?? body?.list ?? (Array.isArray(body) ? body : []);
      setVersions(list);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  const handleExport = async () => {
    try {
      await client.post(`/admin/v1/world/scene-config/${sceneId}/export`);
      message.success('导出成功');
      loadVersions();
    } catch {
      // 拦截器已提示
    }
  };

  const handlePublish = async () => {
    if (targetVersion == null) return;
    setSubmitLoading(true);
    try {
      await client.post(`/admin/v1/world/scene-config/${sceneId}/publish`, { version: targetVersion });
      message.success('发布成功');
      setPublishOpen(false);
      setTargetVersion(null);
      loadVersions();
    } catch {
      // 拦截器已提示
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleRollback = async () => {
    if (targetVersion == null) return;
    setSubmitLoading(true);
    try {
      await client.post(`/admin/v1/world/scene-config/${sceneId}/rollback`, { version: targetVersion });
      message.success('回滚成功');
      setRollbackOpen(false);
      setTargetVersion(null);
      loadVersions();
    } catch {
      // 拦截器已提示
    } finally {
      setSubmitLoading(false);
    }
  };

  const versionOptions = versions.map((v) => ({ value: v.version, label: `v${v.version}` }));

  const columns: ColumnsType<SceneVersion> = [
    { title: 'Version', dataIndex: 'version', width: 100, render: (v) => `v${v}` },
    { title: 'Hash', dataIndex: 'hash', width: 140, render: (h: string) => (h ? h.slice(0, 12) + '...' : '-') },
    { title: '文件路径', dataIndex: 'filePath' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (s: string) => {
        const color = s === 'published' ? 'green' : s === 'draft' ? 'default' : 'blue';
        return s ? <Tag color={color}>{s}</Tag> : '-';
      },
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={handleExport}>
          导出新版本
        </Button>
        <Button onClick={() => setPublishOpen(true)}>发布版本</Button>
        <Button danger onClick={() => setRollbackOpen(true)}>回滚版本</Button>
      </Space>

      <Table<SceneVersion>
        rowKey="id"
        columns={columns}
        dataSource={versions}
        loading={loading}
        pagination={false}
        locale={{ emptyText: '暂无版本' }}
      />

      <Modal
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        onOk={handlePublish}
        okText="确认发布"
        cancelText="取消"
        confirmLoading={submitLoading}
        title="发布版本"
      >
        <div style={{ marginBottom: 8 }}>选择要发布的版本：</div>
        <Select
          style={{ width: '100%' }}
          placeholder="选择版本"
          options={versionOptions}
          onChange={(v) => setTargetVersion(v)}
        />
      </Modal>

      <Modal
        open={rollbackOpen}
        onCancel={() => setRollbackOpen(false)}
        onOk={handleRollback}
        okText="确认回滚"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={submitLoading}
        title="回滚版本"
      >
        <div style={{ marginBottom: 8 }}>选择要回滚到的版本：</div>
        <Select
          style={{ width: '100%' }}
          placeholder="选择版本"
          options={versionOptions}
          onChange={(v) => setTargetVersion(v)}
        />
      </Modal>
    </div>
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
        width={800}
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
              {
                key: 'versions',
                label: '场景配置版本',
                children: <VersionTab sceneId={current.id} />,
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
