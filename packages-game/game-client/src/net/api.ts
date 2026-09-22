import { AppConfig } from '../config/AppConfig';
import { httpJson } from './http';

export interface AuthResult {
  token: string;
  accountId: string;
  playerId: string;
}

/** D8：NPC 头顶任务标记（服务端权威计算，客户端不得自行推断） */
export interface DialogueQuestMarks {
  available: string[];
  submittable: string[];
}

export interface NpcTalkResult {
  spawnId: string;
  npcTemplateId: string;
  name: string;
  talkType: string;
  dialogueId: number | null;
  text: string;
  options: Array<{ text: string; next: string | null }>;
  // ===== S5 增量字段（旧字段零变更，S1 冒烟不回归）=====
  /** 对话编码；未接入对话树（走 attr.greeting 兜底）时为 undefined */
  code?: string;
  /** 当前节点 key；未接入对话树时为 undefined */
  nodeKey?: string;
  /** 当前节点**可见**选项的原始下标（与 options 一一对应，choose 必须回传它） */
  optionIndexes?: number[];
  questMarks?: DialogueQuestMarks;
}

/** 服务端解析后的对话节点（choose / story 返回） */
export interface DialogueNodeResult {
  key: string;
  speaker?: string;
  text: string;
  options: Array<{ index: number; text: string; action?: string; next?: string }>;
}

/** choose / story 的返回：服务端权威的下一节点视图（node 为空且 finished 为真即结束） */
export interface DialogueStepResult {
  code: string;
  nodeKey: string | null;
  node: DialogueNodeResult | null;
  finished: boolean;
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

  /**
   * 对话推进：`optionIndex` 必须是 `optionIndexes[i]`（服务端原始下标），
   * 不是本地列表下标（选项级条件过滤后两者会错位）。
   */
  chooseDialogue(
    code: string,
    nodeKey: string,
    optionIndex: number,
    token: string | null,
  ): Promise<DialogueStepResult> {
    return httpJson<DialogueStepResult>(
      'POST',
      '/api/client/v1/world/dialogue/choose',
      { token, body: { code, nodeKey, optionIndex } },
    );
  },

  /** 剧情触发（scene_triggers.story_id → 对话首节点）；返回形状同 choose 的首节点 */
  triggerStory(triggerId: number, token: string | null): Promise<DialogueStepResult> {
    return httpJson<DialogueStepResult>(
      'POST',
      `/api/client/v1/world/triggers/${triggerId}/story`,
      { token, body: {} },
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