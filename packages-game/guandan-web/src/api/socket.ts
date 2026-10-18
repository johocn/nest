import { io, Socket } from 'socket.io-client';

const BASE = import.meta.env.VITE_API_BASE || '';

export function connectGuandan(token: string): Socket {
  return io(`${BASE}/guandan`, {
    query: { token },
    transports: ['websocket'],
    autoConnect: true,
  });
}
