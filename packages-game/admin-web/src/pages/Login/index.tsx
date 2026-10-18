import { Form, Input, Button, Card, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import client from '../../api/client';

interface LoginParams {
  username: string;
  password: string;
}

export default function Login() {
  const navigate = useNavigate();
  const [form] = Form.useForm<LoginParams>();

  const onFinish = async (values: LoginParams) => {
    try {
      const res = await client.post('/admin/v1/login', values);
      const token = res.data?.data?.token ?? res.data?.token;
      if (!token) {
        message.error('登录响应中未找到 token');
        return;
      }
      localStorage.setItem('admin_token', token);
      message.success('登录成功');
      navigate('/', { replace: true });
    } catch {
      // axios interceptor 已经弹了 message.error，这里静默
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card title="Game Admin 登录" style={{ width: 360 }}>
        <Form form={form} layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="admin" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="••••••" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
