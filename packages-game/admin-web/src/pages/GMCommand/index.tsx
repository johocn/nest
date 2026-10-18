import { useEffect, useState } from 'react';
import {
  Row,
  Col,
  Card,
  Select,
  Input,
  InputNumber,
  Button,
  Timeline,
  Tag,
  Space,
  message,
  Empty,
} from 'antd';
import client from '../../api/client';

type ArgType = 'number' | 'string' | 'boolean';

interface ArgSchema {
  type: ArgType;
  description?: string;
  enum?: (string | number | boolean)[];
}

interface GMCommandDef {
  name: string;
  description: string;
  argsSchema?: Record<string, ArgSchema>;
}

interface ExecResult {
  key: number;
  cmd: string;
  ok: boolean;
  result?: unknown;
  logId?: string;
  error?: string;
  time: string;
}

function renderArgInput(
  key: string,
  schema: ArgSchema,
  value: unknown,
  onChange: (v: unknown) => void,
) {
  const placeholder = schema.description || key;

  if (schema.enum && schema.enum.length > 0) {
    return (
      <Select
        value={value as string | number | undefined}
        onChange={onChange}
        placeholder={placeholder}
        allowClear
        options={schema.enum.map((v) => ({
          label: String(v),
          value: v,
        }))}
      />
    );
  }

  if (schema.type === 'number') {
    return (
      <InputNumber
        style={{ width: '100%' }}
        value={value as number | undefined}
        onChange={onChange}
        placeholder={placeholder}
      />
    );
  }

  if (schema.type === 'boolean') {
    return (
      <Select
        value={value as boolean | undefined}
        onChange={onChange}
        placeholder={placeholder}
        allowClear
        options={[
          { label: 'true', value: true },
          { label: 'false', value: false },
        ]}
      />
    );
  }

  return (
    <Input
      value={value as string | undefined}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

export default function GMCommand() {
  const [cmds, setCmds] = useState<GMCommandDef[]>([]);
  const [selectedCmd, setSelectedCmd] = useState<string | undefined>();
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [targetPlayerId, setTargetPlayerId] = useState<string>('');
  const [execLog, setExecLog] = useState<ExecResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client
      .get('/admin/v1/ops/gm/list')
      .then((res) => {
        const list: GMCommandDef[] = res.data?.data || [];
        setCmds(list);
      })
      .catch(() => {
        // axios 拦截器已弹错
      });
  }, []);

  const currentSchema =
    cmds.find((c) => c.name === selectedCmd)?.argsSchema || {};

  const handleCmdChange = (name: string) => {
    setSelectedCmd(name);
    setArgs({});
  };

  const handleArgChange = (key: string, value: unknown) => {
    setArgs((prev) => ({ ...prev, [key]: value }));
  };

  const handleExecute = async () => {
    if (!selectedCmd) {
      message.warning('请先选择一个 GM 命令');
      return;
    }
    setLoading(true);
    try {
      const res = await client.post('/admin/v1/ops/gm/execute', {
        cmd: selectedCmd,
        targetPlayerId: targetPlayerId || undefined,
        args,
      });
      const data = res.data?.data || {};
      const entry: ExecResult = {
        key: Date.now(),
        cmd: data.cmd || selectedCmd,
        ok: !!data.ok,
        result: data.result,
        logId: data.logId,
        error: data.error,
        time: new Date().toLocaleTimeString(),
      };
      setExecLog((prev) => [entry, ...prev].slice(0, 20));
      if (data.ok) {
        message.success(`执行成功 (logId=${data.logId ?? '-'})`);
      } else {
        message.error(`执行失败: ${data.error || '未知错误'}`);
      }
    } catch {
      // 拦截器已处理
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>GM 命令中心</h2>
      <Row gutter={16}>
        <Col span={10}>
          <Card title="命令执行">
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              <div>
                <div style={{ marginBottom: 6, fontWeight: 500 }}>
                  选择命令
                </div>
                <Select
                  style={{ width: '100%' }}
                  placeholder="请选择 GM 命令"
                  value={selectedCmd}
                  onChange={handleCmdChange}
                  options={cmds.map((c) => ({
                    label: `${c.name} — ${c.description}`,
                    value: c.name,
                  }))}
                  showSearch
                  optionFilterProp="label"
                />
              </div>

              {selectedCmd &&
                Object.entries(currentSchema).map(([key, schema]) => (
                  <div key={key}>
                    <div style={{ marginBottom: 6, fontWeight: 500 }}>
                      {key}
                      {schema.description && (
                        <span style={{ color: '#999', fontWeight: 400, marginLeft: 8 }}>
                          ({schema.description})
                        </span>
                      )}
                    </div>
                    {renderArgInput(
                      key,
                      schema,
                      args[key],
                      (v) => handleArgChange(key, v),
                    )}
                  </div>
                ))}

              <div>
                <div style={{ marginBottom: 6, fontWeight: 500 }}>
                  目标玩家 ID
                </div>
                <Input
                  value={targetPlayerId}
                  onChange={(e) => setTargetPlayerId(e.target.value)}
                  placeholder="可选，留空则对自己执行"
                  allowClear
                />
              </div>

              <Button
                type="primary"
                loading={loading}
                onClick={handleExecute}
                block
                disabled={!selectedCmd}
              >
                执行
              </Button>
            </Space>
          </Card>
        </Col>

        <Col span={14}>
          <Card title="执行日志">
            {execLog.length === 0 ? (
              <Empty description="暂无执行记录" />
            ) : (
              <Timeline
                items={execLog.map((e) => ({
                  color: e.ok ? 'green' : 'red',
                  children: (
                    <div key={e.key}>
                      <div style={{ marginBottom: 4 }}>
                        <Tag color={e.ok ? 'green' : 'red'}>
                          {e.ok ? '成功' : '失败'}
                        </Tag>
                        <span style={{ fontWeight: 600 }}>{e.cmd}</span>
                        <span style={{ color: '#999', marginLeft: 8 }}>
                          {e.time}
                        </span>
                      </div>
                      {e.logId && (
                        <div style={{ color: '#666' }}>logId: {e.logId}</div>
                      )}
                      {e.error ? (
                        <div style={{ color: '#cf1322' }}>
                          error: {e.error}
                        </div>
                      ) : e.result !== undefined ? (
                        <pre
                          style={{
                            background: '#f5f5f5',
                            padding: 8,
                            borderRadius: 4,
                            margin: '4px 0 0',
                            fontSize: 12,
                            maxHeight: 160,
                            overflow: 'auto',
                          }}
                        >
                          {typeof e.result === 'string'
                            ? e.result
                            : JSON.stringify(e.result, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
