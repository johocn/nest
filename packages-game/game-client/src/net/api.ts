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

/** 角色创建入参（profession/gender 用服务端枚举小写值，如 'farmer' / 'male'） */
export interface CharacterCreateReq {
  name: string;
  nickname: string;
  profession: string;
  gender: string;
  age: number;
  birthday?: string;
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

  // ===== Buff 玩家端（路径与后端 buff.client.controller 逐字一致）=====

  /** 主动触发 buff（战斗系统也会调此接口） */
  applyBuff(buffTemplateId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/buff/apply', {
      token, body: { buffTemplateId },
    });
  },

  /** 当前角色所有 active buff（Redis 缓存优先） */
  getActiveBuffs(token: string | null): Promise<any[]> {
    return httpJson<any[]>('GET', '/api/client/v1/buff/active', { token });
  },

  /** 主动移除某个 buff（按 templateId） */
  removeBuff(buffTemplateId: string, token: string | null): Promise<{ success: boolean }> {
    return httpJson<{ success: boolean }>(
      'DELETE',
      `/api/client/v1/buff/${buffTemplateId}`,
      { token },
    );
  },

  /** 计算 buff 修正后的角色属性（传入 baseStats 返回 modifiedStats） */
  calculateBuffStats(baseStats: Record<string, number>, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/buff/stats', {
      token, body: { baseStats },
    });
  },

  // ===== Skill 玩家端 =====

  /** 施放技能（attacker 自动取当前玩家角色；defenderCharacterId/baseStats/currentMp 由前端传入） */
  castSkill(
    skillTemplateId: string,
    defenderCharacterId: string | null,
    baseStats: Record<string, number> | null,
    currentMp: number | null,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/skill/cast', {
      token,
      body: { skillTemplateId, defenderCharacterId, baseStats, currentMp },
    });
  },

  /** 可用技能模板列表 */
  getAvailableSkills(token: string | null): Promise<any[]> {
    return httpJson<any[]>('GET', '/api/client/v1/skill/available', { token });
  },

  /** 查询技能是否在冷却中 */
  checkSkillCooldown(skillTemplateId: string, token: string | null): Promise<{ onCooldown: boolean }> {
    return httpJson<{ onCooldown: boolean }>('POST', '/api/client/v1/skill/cooldown', {
      token, body: { skillTemplateId },
    });
  },

  // ===== Drop 玩家端 =====

  /** 触发一次掉落（自动入背包，rollDrop 内部调 inventoryService.addItem） */
  rollDrop(dropTemplateId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/drop/roll', {
      token, body: { dropTemplateId },
    });
  },

  /** 掉落表详情（玩家端可看掉落配置） */
  getDropTemplate(id: string, token: string | null): Promise<any> {
    return httpJson<any>('GET', `/api/client/v1/drop/template/${id}`, { token });
  },

  /** 掉落表列表（分页） */
  listDropTemplates(
    page = 1,
    limit = 50,
    token: string | null,
  ): Promise<any> {
    const query = `?page=${page}&limit=${limit}`;
    return httpJson<any>('GET', `/api/client/v1/drop/templates${query}`, { token });
  },

  // ===== Trade 玩家端 =====

  /** 交易市场列表 */
  getTradeMarket(page = 1, limit = 20, token: string | null): Promise<any> {
    const query = `?page=${page}&limit=${limit}`;
    return httpJson<any>('GET', `/api/client/v1/trade/market${query}`, { token });
  },

  /** 拍卖列表（exclusive=true 只看专属拍卖室） */
  getTradeAuctions(
    page = 1,
    limit = 20,
    exclusive?: boolean,
    token?: string | null,
  ): Promise<any> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (exclusive !== undefined) params.set('exclusive', String(exclusive));
    return httpJson<any>('GET', `/api/client/v1/trade/auction/list?${params}`, { token });
  },

  /** 我的赊账列表 */
  getTradeCreditMine(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/trade/credit/mine', { token });
  },

  /** 悬赏榜 */
  getTradeBounties(page = 1, limit = 20, token: string | null): Promise<any> {
    const query = `?page=${page}&limit=${limit}`;
    return httpJson<any>('GET', `/api/client/v1/trade/bounties${query}`, { token });
  },

  /** 我的易物列表 */
  getTradeBarterMine(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/trade/barter/mine', { token });
  },

  // ===== Player 玩家端 =====

  /** 玩家基础信息 */
  getPlayerBaseInfo(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/player/base-info', { token });
  },

  /** 修改昵称（2-16 字符） */
  changeNickname(nickname: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/player/change-nickname', {
      token, body: { nickname },
    });
  },

  /** 新手保护期状态 */
  getPlayerProtection(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/player/protection', { token });
  },

  // ===== Character 角色端 =====

  /** 创建角色（登录后无角色必须先调用） */
  createCharacter(req: CharacterCreateReq, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/character/create', {
      token, body: req,
    });
  },

  /** 角色完整档案（未建角报 PLAYER_NOT_FOUND） */
  getCharacterProfile(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/character/profile', { token });
  },

  /** 更新角色属性（全可选；combatPower 为 bigint 字符串） */
  updateCharacterAttribute(
    attrs: Partial<{
      strength: number;
      speed: number;
      defense: number;
      intelligence: number;
      comprehension: number;
      loyalty: number;
      combatPower: string;
    }>,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('PUT', '/api/client/v1/character/attribute', {
      token, body: attrs,
    });
  },

  /** 更新角色位置（region 用服务端 Region 枚举值，如 'central_city'） */
  updateCharacterLocation(
    loc: Partial<{
      mapId: string;
      landId: string;
      region: string;
      posX: number;
      posY: number;
      posZ: number;
      building: string;
      indoors: boolean;
    }>,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('PUT', '/api/client/v1/character/location', {
      token, body: loc,
    });
  },

  /** 更新角色状态（health/reputation/season 为整数，wealth 为 bigint 字符串） */
  updateCharacterStatus(
    status: Partial<{
      health: number;
      wealth: string;
      reputation: number;
      isAlive: boolean;
      deathCause: string;
      season: number;
    }>,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('PUT', '/api/client/v1/character/status', {
      token, body: status,
    });
  },

  /** 更新阵营（faction: 'righteous' | 'evil' | 'neutral'） */
  updateCharacterFaction(
    faction: Partial<{ faction: string; factionName: string; factionLevel: number }>,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('PUT', '/api/client/v1/character/faction', {
      token, body: faction,
    });
  },

  /** 更新角色物资（全可选整数） */
  updateCharacterResource(
    res: Partial<{ food: number; wood: number; iron: number; herb: number; gold: number }>,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('PUT', '/api/client/v1/character/resource', {
      token, body: res,
    });
  },

  /** 更新/创建武学（artType: 'fist'|'palm'|'leg'|'weapon'，level 0-100） */
  upsertCharacterMartialArt(
    artType: string,
    level: number,
    skills: any | null,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('PUT', '/api/client/v1/character/martial-art', {
      token, body: { artType, level, skills: skills ?? undefined },
    });
  },

  /** 武学列表 */
  getCharacterMartialArts(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/character/martial-arts', { token });
  },

  /** 添加关系（favorability -1000~1000） */
  addCharacterRelationship(
    targetId: string,
    favorability: number,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/character/relationship', {
      token, body: { targetId, favorability },
    });
  },

  /** 关系列表 */
  getCharacterRelationships(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/character/relationships', { token });
  },

  /** 设置名号/诗号（alias 1-24 字，poem 1-64 字，均可选） */
  updateCharacterCard(
    card: Partial<{ alias: string; poem: string }>,
    token: string | null,
  ): Promise<any> {
    return httpJson<any>('PUT', '/api/client/v1/character/card', {
      token, body: card,
    });
  },

  /** 装备/卸下称号 */
  equipCharacterTitle(titleId: string, equip: boolean, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/character/titles/equip', {
      token, body: { titleId, equip },
    });
  },

  /** 我的称号列表 */
  getCharacterTitles(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/character/titles', { token });
  },

  /** 查看他人名片（characterId 为 characters.id） */
  getCharacterCard(characterId: string, token: string | null): Promise<any> {
    return httpJson<any>('GET', `/api/client/v1/character/card/${characterId}`, { token });
  },

  // ===== Inventory 背包端 =====

  /** 背包列表 */
  getInventory(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/inventory/list', { token });
  },

  /** 使用消耗品 */
  useItem(itemTemplateId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/inventory/use', {
      token, body: { itemTemplateId },
    });
  },

  /** 穿戴装备（characterId 为 characters.id，可从角色档案取） */
  equipItem(characterId: string, inventoryItemId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/inventory/equip', {
      token, body: { characterId, inventoryItemId },
    });
  },

  /** 卸下装备（slot: 'weapon'|'helmet'|'armor'|'boots'|'accessory'） */
  unequipItem(characterId: string, slot: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/inventory/unequip', {
      token, body: { characterId, slot },
    });
  },

  // ===== Quest 任务端（questTemplateId 为纯数字模板 id）=====

  /** 玩家任务列表 */
  listQuests(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/quest/list', { token });
  },

  /** 接取任务 */
  acceptQuest(questTemplateId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/quest/accept', {
      token, body: { questTemplateId },
    });
  },

  /** 提交任务领奖 */
  submitQuest(questTemplateId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/quest/submit', {
      token, body: { questTemplateId },
    });
  },

  /** 领取任务奖励（auto_reward=false 的任务走这里） */
  claimQuestReward(questTemplateId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/quest/claim', {
      token, body: { questTemplateId },
    });
  },

  /** 发起卡关求助（questTemplateId 必须纯数字，否则 400） */
  requestQuestHelp(questTemplateId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/quest/help/request', {
      token, body: { questTemplateId },
    });
  },

  /** 我的求助与可协助列表 */
  listQuestHelp(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/quest/help/mine', { token });
  },

  /** 协助他人任务（helpId 为求助记录纯数字 id） */
  respondQuestHelp(helpId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', `/api/client/v1/quest/help/${helpId}/respond`, { token });
  },

  // ===== Mail 邮件端 =====

  /** 邮件列表 */
  listMail(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/mail/list', { token });
  },

  /** 标记已读 */
  readMail(mailId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', `/api/client/v1/mail/${mailId}/read`, { token });
  },

  /** 领取附件 */
  claimMailAttachment(mailId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', `/api/client/v1/mail/${mailId}/claim`, { token });
  },

  // ===== Economy 经济端 =====

  /** 社交货币余额（人情值/帮贡/颜面） */
  getSocialBalances(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/economy/social/balances', { token });
  },

  /** 货币兑换（仅钻石↔绑定钻；from/to 取 CurrencyType 小写值：gold/diamond/bound_diamond/favor/guild_contrib/face/infamy） */
  exchangeCurrency(from: string, to: string, amount: number, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/economy/exchange', {
      token, body: { from, to, amount },
    });
  },

  // ===== Realm 境界端 =====

  /** 我的境界（境界/修为/下一档模板） */
  getMyRealm(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/realm/my', { token });
  },

  /** 投入修为（amount ≥ 1） */
  cultivateRealm(amount: number, token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/realm/cultivate', {
      token, body: { amount },
    });
  },

  /** 境界突破（达标→消耗→升级→里程碑发奖） */
  breakthroughRealm(token: string | null): Promise<any> {
    return httpJson<any>('POST', '/api/client/v1/realm/breakthrough', { token, body: {} });
  },

  // ===== Explore 探索端 =====

  /** 当前昼夜 / 天气 */
  getWorldState(token: string | null): Promise<any> {
    return httpJson<any>('GET', '/api/client/v1/explore/state', { token });
  },

  /** 探索足迹：点亮场景（首探发里程碑奖，幂等 times 递加） */
  discoverScene(sceneId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', `/api/client/v1/explore/scene/${sceneId}/discover`, {
      token, body: {},
    });
  },

  /** 奇遇触发：按触发率/CD/一次性判定，命中返回选项 */
  triggerEncounter(sceneId: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', `/api/client/v1/explore/scene/${sceneId}/encounter`, {
      token, body: {},
    });
  },

  /** 奇遇结算：choice 为所选选项 id（幂等防重复） */
  resolveEncounter(encounterId: string, choice: string, token: string | null): Promise<any> {
    return httpJson<any>('POST', `/api/client/v1/explore/encounter/${encounterId}/resolve`, {
      token, body: { choice },
    });
  },
};