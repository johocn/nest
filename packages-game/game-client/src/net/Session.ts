import { Platform } from '../platform/Platform';
import type { AuthResult } from './api';

const K_TOKEN = 's1.token';
const K_ACCOUNT = 's1.accountId';
const K_PLAYER = 's1.playerId';

export const Session = {
  token: null as string | null,
  accountId: null as string | null,
  playerId: null as string | null,

  load(): void {
    Session.token = Platform.storageGet(K_TOKEN);
    Session.accountId = Platform.storageGet(K_ACCOUNT);
    Session.playerId = Platform.storageGet(K_PLAYER);
  },

  save(result: AuthResult): void {
    Session.token = result.token;
    Session.accountId = result.accountId;
    Session.playerId = result.playerId;
    Platform.storageSet(K_TOKEN, result.token);
    Platform.storageSet(K_ACCOUNT, result.accountId);
    Platform.storageSet(K_PLAYER, result.playerId);
    console.log(`[S1] 登录成功 playerId=${result.playerId} token=${result.token.slice(0, 16)}…`);
  },

  clear(): void {
    Session.token = null;
    Session.accountId = null;
    Session.playerId = null;
    Platform.storageRemove(K_TOKEN);
    Platform.storageRemove(K_ACCOUNT);
    Platform.storageRemove(K_PLAYER);
  },
};