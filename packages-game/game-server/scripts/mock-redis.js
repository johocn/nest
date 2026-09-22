// Redis-compatible mock server for development
// Supports both RESP2 and RESP3 protocol (inline and array format)
const net = require('net');

const store = new Map();
const DELIM = '\r\n';

// RESP protocol parser
function parseRESP(data) {
  if (!data || data.length === 0) return null;
  const type = data[0];
  if (type === '*') {
    const idx = data.indexOf(DELIM);
    if (idx === -1) return null;
    const count = parseInt(data.slice(1, idx), 10);
    if (isNaN(count) || count <= 0) return null;
    let pos = idx + 2;
    const args = [];
    for (let i = 0; i < count; i++) {
      if (pos >= data.length) return null;
      if (data[pos] !== '$') return null;
      const nl = data.indexOf(DELIM, pos);
      if (nl === -1) return null;
      const len = parseInt(data.slice(pos + 1, nl), 10);
      pos = nl + 2;
      if (pos + len > data.length) return null;
      args.push(data.slice(pos, pos + len));
      pos = pos + len + 2;
    }
    return { args, consumed: pos };
  }
  // Inline command
  const nl = data.indexOf(DELIM);
  if (nl === -1) return null;
  const parts = data.slice(0, nl).trim().split(/\s+/);
  if (parts.length === 0) return null;
  return { args: parts, consumed: nl + 2 };
}

function cmd(args) {
  return args[0]?.toUpperCase();
}

function writeResp(socket, type, value) {
  if (type === 'OK') return socket.write('+OK\r\n');
  if (type === 'PONG') return socket.write('+PONG\r\n');
  if (type === 'QUEUED') return socket.write('+QUEUED\r\n');
  if (type === 'NULL') return socket.write('$-1\r\n');
  if (type === 'INT') return socket.write(`:${value}\r\n`);
  if (type === 'BULK') {
    if (value === null || value === undefined) return socket.write('$-1\r\n');
    const str = String(value);
    return socket.write(`$${Buffer.byteLength(str)}\r\n${str}\r\n`);
  }
  if (type === 'ARRAY') {
    if (!value || value.length === 0) return socket.write('*0\r\n');
    let resp = `*${value.length}\r\n`;
    for (const v of value) {
      const str = String(v);
      resp += `$${Buffer.byteLength(str)}\r\n${str}\r\n`;
    }
    return socket.write(resp);
  }
  if (type === 'MAP') {
    // RESP3 MAP: %<count>\r\n<key-value pairs>
    const keys = Object.keys(value);
    let resp = `%${keys.length}\r\n`;
    for (const k of keys) {
      const kStr = String(k), vStr = String(value[k]);
      resp += `$${Buffer.byteLength(kStr)}\r\n${kStr}\r\n`;
      resp += `$${Buffer.byteLength(vStr)}\r\n${vStr}\r\n`;
    }
    return socket.write(resp);
  }
  socket.write('+OK\r\n');
}

// Transaction queue
let multiQueue = null;

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  let buf = '';

  socket.on('data', (chunk) => {
    buf += chunk;
    let parsed;

    while ((parsed = parseRESP(buf)) !== null) {
      buf = buf.slice(parsed.consumed);
      const { args } = parsed;
      const op = cmd(args);

      // Transaction commands
      if (op === 'MULTI') { multiQueue = []; writeResp(socket, 'OK'); continue; }
      if (op === 'EXEC') {
        if (multiQueue === null) { writeResp(socket, 'NULL'); continue; }
        const results = multiQueue.map(q => {
          const o = cmd(q);
          if (o === 'SET') { store.set(q[1], q.slice(2).join(' ')); return '+OK'; }
          if (o === 'DEL') { store.delete(q[1]); return ':1'; }
          if (o === 'GET') { const v = store.get(q[1]); return v !== undefined ? `$${Buffer.byteLength(v)}\r\n${v}` : '$-1'; }
          return '+OK';
        });
        multiQueue = null;
        let resp = `*${results.length}\r\n`;
        for (const r of results) resp += r + '\r\n';
        return socket.write(resp);
      }
      if (op === 'DISCARD') { multiQueue = null; writeResp(socket, 'OK'); continue; }
      if (multiQueue !== null) { multiQueue.push(args); writeResp(socket, 'QUEUED'); continue; }

      // Key-value commands
      if (op === 'PING') writeResp(socket, 'PONG');
      else if (op === 'HELLO') {
        // Return proper HELLO response (RESP3 map)
        writeResp(socket, 'MAP', { server: 'mock-redis', version: '6.0.0', proto: 3, id: 1, mode: 'standalone', role: 'master' });
      }
      else if (op === 'SET' && args.length >= 3) {
        // 注意：SET key value [NX|XX] [EX n|PX n ...] —— 值只取第 3 个参数，选项要单独解析，
        // 否则 value 会被拼成 "1 EX 60" 且永不过期（曾导致限流计数永久累积）。
        const key = args[1];
        // NX：键已存在时不写、返回 nil（acquireLock 依赖该语义，缺失会让锁恒成功）
        const hasNx = args.some((a) => String(a).toUpperCase() === 'NX');
        if (hasNx && store.has(key)) {
          writeResp(socket, 'NULL');
          continue;
        }
        store.set(key, args[2]);
        for (let i = 3; i < args.length; i++) {
          const o = args[i]?.toUpperCase();
          if ((o === 'EX' || o === 'PX') && args[i + 1] !== undefined) {
            const n = parseInt(args[i + 1], 10);
            if (!isNaN(n)) {
              // setTimeout 上限约 24.8 天（32 位），超出会被静默改成 1ms 而立即删键
              // （曾导致一年期的一次性锁/剧情锁瞬间失效），此处做上界钳制。
              const ms = o === 'EX' ? n * 1000 : n;
              setTimeout(() => store.delete(key), Math.min(ms, 2147483647));
            }
            i++;
          }
        }
        writeResp(socket, 'OK');
      }
      else if (op === 'GET') {
        const v = store.get(args[1]);
        writeResp(socket, 'BULK', v !== undefined ? v : null);
      }
      else if (op === 'DEL') {
        const count = args.slice(1).filter(k => store.has(k)).length;
        args.slice(1).forEach(k => store.delete(k));
        writeResp(socket, 'INT', count);
      }
      else if (op === 'EXISTS') {
        writeResp(socket, 'INT', args.slice(1).filter(k => store.has(k)).length);
      }
      else if (op === 'TTL') {
        writeResp(socket, 'INT', -1);
      }
      else if (op === 'SADD') {
        // Set：值以 Set 存于 store（与 String 值共存，靠 instanceof 区分）
        let set = store.get(args[1]);
        if (!(set instanceof Set)) { set = new Set(); store.set(args[1], set); }
        let added = 0;
        for (const member of args.slice(2)) {
          if (!set.has(member)) { set.add(member); added++; }
        }
        writeResp(socket, 'INT', added);
      }
      else if (op === 'SREM') {
        const set = store.get(args[1]);
        let removed = 0;
        if (set instanceof Set) {
          for (const member of args.slice(2)) if (set.delete(member)) removed++;
        }
        writeResp(socket, 'INT', removed);
      }
      else if (op === 'SMEMBERS') {
        const set = store.get(args[1]);
        writeResp(socket, 'ARRAY', set instanceof Set ? [...set] : []);
      }
      else if (op === 'KEYS') {
        writeResp(socket, 'ARRAY', [...store.keys()]);
      }
      else if (op === 'FLUSHDB' || op === 'FLUSHALL') {
        store.clear();
        writeResp(socket, 'OK');
      }
      else if (op === 'SELECT' || op === 'CLIENT' || op === 'AUTH') {
        writeResp(socket, 'OK');
      }
      else if (op === 'INFO') {
        writeResp(socket, 'BULK', '# Server\r\nredis_version:6.0.0\r\n');
      }
      else {
        writeResp(socket, 'OK');
      }
    }
  });

  socket.on('error', () => {});
});

server.listen(6379, '0.0.0.0', () => {
  console.log('Mock Redis (RESP compatible) listening on port 6379');
});