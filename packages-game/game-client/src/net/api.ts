import { AppConfig } from '../config/AppConfig';
import { httpJson } from './http';

export interface AuthResult {
  token: string;
  accountId: string;
  playerId: string;
}

export interface NpcTalkResult {
  spawnId: string;
  npcTemplateId: string;
  name: string;
  talkType: string;
  dialogueId: number | null;
  text: string;
  options: Array<{ text: string; next: string | null }>;
}

export interface InteractResult {
  ok: boolean;
  reward?: { type?: string; currencyType?: string; amount?: number } | null;
}

/** 机关激活结果（world.service.activateTrigger） */
export interface TriggerActivateResult {
  unlocked: boolean;
  members: string[];
}

export interface MountResult {
  ok: boolean;
}

export const Api = {
  /** login 不能带 nickname（DTO 无该字段，forbidNonWhitelisted 会 400） */
  login(username: string, password: string): Promise<AuthResult> {
    return httpJson<AuthResult>('POST', '/api/client/v1/auth/login', {
      body: { username, password, deviceId: AppConfig.deviceId },
    });
  },

  register(username: string, password: string, nickname: string): Promise<AuthResult> {
    return httpJson<AuthResult>('POST', '/api/client/v1/auth/register', {
      body: { username, password, nickname, deviceId: AppConfig.deviceId },
    });
  },

  /** objectTemplateId 是 object_templates.id（不是 spawnId），与后端 interactObject 契约一致 */
  interactObject(
    objectTemplateId: number,
    interactType: string,
    token: string | null,
  ): Promise<InteractResult> {
    return httpJson<InteractResult>(
      'POST',
      `/api/client/v1/world/objects/${objectTemplateId}/interact`,
      { token, body: { interactType } },
    );
  },

  talkNpc(spawnId: number, token: string | null): Promise<NpcTalkResult> {
    return httpJson<NpcTalkResult>(
      'POST',
      `/api/client/v1/world/npcs/${spawnId}/talk`,
      { token },
    );
  },

  /** triggerId 是 scene_triggers.id；后端仅允许 PUZZLE/GATE/TRAP（TriggerActivateDto 的 memberIds 可选，缺省单人） */
  activateTrigger(triggerId: number, token: string | null): Promise<TriggerActivateResult> {
    return httpJson<TriggerActivateResult>(
      'POST',
      `/api/client/v1/world/triggers/${triggerId}/activate`,
      { token, body: {} },
    );
  },

  /** 骑乘/收起坐骑；mountId 必填（MountActionDto），需已 equip 过对应坐骑 */
  rideMount(mountId: string, token: string | null): Promise<MountResult> {
    return httpJson<MountResult>('POST', '/api/client/v1/world/mounts/ride', {
      token,
      body: { mountId, ride: true },
    });
  },
};