import type { WsClient, WsMessage } from './ws';

export type ChatChannelType = 'world' | 'private' | 'guild';

/** 与服务端 chat.message 广播的 data 逐字一致（recipientId/guildId 缺省为 null） */
export interface ChatMessageView {
  channel: ChatChannelType;
  senderId: string | number;
  senderName: string;
  content: string;
  messageId: string | number;
  recipientId: string | number | null;
  guildId: string | number | null;
}

export interface ChatAttachOptions {
  onMessage?: (m: ChatMessageView) => void;
  onSupportReply?: (reply: unknown) => void;
}

/** 有界缓冲上限：超出丢最旧。模块级，跨「退出登录 → 重登」保留最近消息 */
const CHAT_BUFFER_LIMIT = 50;

let buffer: ChatMessageView[] = [];

/** 注册 chat.message / chat.support_reply 广播处理；opts 可省略（只缓冲不回调） */
export function attachChat(ws: WsClient, opts?: ChatAttachOptions): void {
  ws.on('chat.message', (m: WsMessage) => {
    const d = m?.data;
    if (!d || typeof d.content !== 'string' || typeof d.channel !== 'string') return;
    const view: ChatMessageView = {
      channel: d.channel as ChatChannelType,
      senderId: d.senderId,
      senderName: d.senderName,
      content: d.content,
      messageId: d.messageId,
      recipientId: d.recipientId ?? null,
      guildId: d.guildId ?? null,
    };
    buffer.push(view);
    if (buffer.length > CHAT_BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - CHAT_BUFFER_LIMIT);
    }
    if (opts?.onMessage) opts.onMessage(view);
  });
  ws.on('chat.support_reply', (m: WsMessage) => {
    if (opts?.onSupportReply) opts.onSupportReply(m?.data?.reply);
  });
}

/** 最近消息快照（旧→新），不影响缓冲本身 */
export function getRecentChatMessages(): ChatMessageView[] {
  return buffer.slice();
}

/** 上行 chat.send；ack code!==0（违禁词/冷却等业务错误）时 throw Error(msg) */
export async function sendChat(
  ws: WsClient,
  params: { channel: ChatChannelType; content: string; recipientId?: string | null; guildId?: string | null },
): Promise<{ messageId: string }> {
  const ack = await ws.send<{ messageId?: string | number }>('chat.send', params);
  if (ack.code !== 0) throw new Error(ack.msg || `chat.send 失败（code=${ack.code}）`);
  return { messageId: String(ack.data?.messageId ?? '') };
}
