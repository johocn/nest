import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

// 前端开发时通过 Vite 代理转发到后端（默认 3000 端口）。
// 可用 .env 的 VITE_BACKEND_TARGET 覆盖，例如：VITE_BACKEND_TARGET=http://127.0.0.1:3000
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_BACKEND_TARGET || 'http://localhost:3000';
  return {
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/guandan': { target, ws: true, changeOrigin: true },
      },
    },
  };
});
