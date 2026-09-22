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

// ===== S6 建造（字段名与后端视图逐字一致，勿改）=====

/** 建造模式（后端 `BuildMode`） */
export type BuildMode = 'solo' | 'coop' | 'forbidden';

/** 建筑状态（后端 `BuildingState`） */
export type BuildingState = 'building' | 'built' | 'demolishing';

/** 保留区（**格点**坐标，半开矩形 [x,x+w) × [y,y+h)） */
export interface BuildReservedZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 场景建造规则视图（`GET /world/scenes/:sceneId/build-rule`；无规则行 → mode='forbidden'） */
export interface BuildRuleView {
  id: string | null;
  sceneId: string;
  mode: BuildMode;
  /** 每格边长（像素） */
  landGridSize: number;
  maxBuildingsPerPlayer: number;
  allowDemolish: boolean;
  coopMinContributors: number;
  coopExpireHours: number;
  reservedZones: BuildReservedZone[];
}

/** 建筑实例视图（`x/y` = 锚点格中心像素，`w/h` = 占地格数） */
export interface BuildingView {
  id: string;
  sceneId: string;
  templateId: string;
  ownerId: string;
  state: BuildingState;
  finishAt: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 建造消耗单项（与后端 `building_templates.build_cost` 元素同形） */
export interface BuildCostEntry {
  itemTemplateId?: string;
  currencyType?: string;
  amount: number;
}

/** 建筑蓝图（`GET /world/building-templates`，只返回启用中的蓝图） */
export interface BuildingTemplate {
  id: string;
  name: string;
  resKey: string;
  category: string;
  footprintW: number;
  footprintH: number;
  buildCost: BuildCostEntry[];
  buildSeconds: number;
  durability: number;
  effect: Record<string, unknown>;
  isActive: boolean;
}

/** 共建投料结果 */
export interface ContributeResult {
  building: BuildingView;
  reached: boolean;
  contributors: number;
}

/** 拆除结果（`refunded` 恒为 false：D7 不退款） */
export interface DemolishResult {
  building: BuildingView;
  refunded: boolean;
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

  // ===== S6 建造（路径与后端 world.client.controller 逐字一致）=====

  /** 场景建造规则；无规则行的场景返回 mode='forbidden' 的默认视图（服务端权威） */
  getBuildRule(sceneId: string, token: string | null): Promise<BuildRuleView> {
    return httpJson<BuildRuleView>(
      'GET',
      `/api/client/v1/world/scenes/${sceneId}/build-rule`,
      { token },
    );
  },

  /** 场景建筑列表（ownerId 可选过滤） */
  listBuildings(
    sceneId: string,
    ownerId: string | null,
    token: string | null,
  ): Promise<BuildingView[]> {
    const query = ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : '';
    return httpJson<BuildingView[]>(
      'GET',
      `/api/client/v1/world/scenes/${sceneId}/buildings${query}`,
      { token },
    );
  },

  /**
   * 建筑蓝图列表。⚠️ **计划外补充的只读接口**（计划 Task 6 的 5 个接口未含蓝图），
   * 服务端只返回 `isActive=true` 的蓝图；category 可选过滤。
   */
  listBuildingTemplates(
    category: string | null,
    token: string | null,
  ): Promise<BuildingTemplate[]> {
    const query = category ? `?category=${encodeURIComponent(category)}` : '';
    return httpJson<BuildingTemplate[]>(
      'GET',
      `/api/client/v1/world/building-templates${query}`,
      { token },
    );
  },

  /** 建造建筑（sceneId 随 body 下发；solo/coop 由服务端按规则模式分派） */
  createBuilding(
    req: { sceneId: string; templateId: string; gx: number; gy: number },
    token: string | null,
  ): Promise<BuildingView> {
    return httpJson<BuildingView>('POST', '/api/client/v1/world/buildings', {
      token,
      body: req,
    });
  },

  /** 共建投料（items 形状与蓝图 buildCost 一致） */
  contributeBuilding(
    buildingId: string,
    items: BuildCostEntry[],
    token: string | null,
  ): Promise<ContributeResult> {
    return httpJson<ContributeResult>(
      'POST',
      `/api/client/v1/world/buildings/${buildingId}/contribute`,
      { token, body: { items } },
    );
  },

  /** 拆除建筑（仅所有者；不退款） */
  demolishBuilding(buildingId: string, token: string | null): Promise<DemolishResult> {
    return httpJson<DemolishResult>(
      'POST',
      `/api/client/v1/world/buildings/${buildingId}/demolish`,
      { token, body: {} },
    );
  },
};