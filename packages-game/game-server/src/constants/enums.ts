export enum AccountType {
  NORMAL = 'normal',
  GUEST = 'guest',
  WECHAT = 'wechat',
  GOOGLE = 'google',
}

export enum AccountStatus {
  ACTIVE = 'active',
  BANNED = 'banned',
}

export enum AdminRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  OPERATOR = 'operator',
  VIEWER = 'viewer',
}

export enum CurrencyType {
  GOLD = 'gold',
  DIAMOND = 'diamond',
  BOUND_DIAMOND = 'bound_diamond',
}

export enum TransactionType {
  EARN = 'earn',
  SPEND = 'spend',
  TRADE = 'trade',
  RECHARGE = 'recharge',
  REWARD = 'reward',
}

export enum PlayerOnlineStatus {
  OFFLINE = 0,
  ONLINE = 1,
}

// ===== 角色模块枚举 =====

export enum Profession {
  FARMER = 'farmer',
  LUMBERJACK = 'lumberjack',
  MINER = 'miner',
  MERCHANT = 'merchant',
  GUARD = 'guard',
  CRAFTSMAN = 'craftsman',
  DOCTOR = 'doctor',
  TEACHER = 'teacher',
  BEGGAR = 'beggar',
  KILLER = 'killer',
  NOBLE = 'noble',
  MONK = 'monk',
  ASSASSIN = 'assassin',
  SPY = 'spy',
  BLACKSMITH = 'blacksmith',
  ALCHEMIST = 'alchemist',
  SCHOLAR = 'scholar',
  GENERAL = 'general',
  THIEF = 'thief',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
}

export enum Faction {
  RIGHTEOUS = 'righteous',
  EVIL = 'evil',
  NEUTRAL = 'neutral',
}

export enum Region {
  CENTRAL_CITY = 'central_city',
  BLACK_FOREST = 'black_forest',
  IRON_MINE = 'iron_mine',
  GOLD_PLAIN = 'gold_plain',
  WILDERNESS = 'wilderness',
}

export enum CombatStyle {
  AGGRESSIVE = 'aggressive',
  DEFENSIVE = 'defensive',
  BALANCED = 'balanced',
  TACTICAL = 'tactical',
}

export enum HungerStatus {
  WELL_FED = 'well_fed',
  NORMAL = 'normal',
  HUNGRY = 'hungry',
  STARVING = 'starving',
  DEAD = 'dead',
}

export enum QualificationType {
  CONSUMABLE = 'consumable',
  NORMAL = 'normal',
  ELITE = 'elite',
  EXPERT = 'expert',
  LEGENDARY = 'legendary',
}

export enum CompanionType {
  TEMPORARY = 'temporary',
  PERMANENT = 'permanent',
  NONE = 'none',
}

export enum MartialArtType {
  FIST = 'fist',
  PALM = 'palm',
  LEG = 'leg',
  WEAPON = 'weapon',
}

export enum RelationshipLevel {
  HOSTILE = 'hostile',
  STRANGER = 'stranger',
  ACQUAINTANCE = 'acquaintance',
  TRUST = 'trust',
  CLOSE = 'close',
  SOULMATE = 'soulmate',
}

export enum RelationshipStatus {
  NORMAL = 'normal',
  GRUDGE = 'grudge',
  BETRAYING = 'betraying',
  BETRAYED = 'betrayed',
  DARKENED = 'darkened',
}

// ===== 背包道具模块枚举 =====

export enum ItemType {
  EQUIPMENT = 'equipment',
  CONSUMABLE = 'consumable',
  MATERIAL = 'material',
  QUEST = 'quest',
}

export enum ItemRarity {
  COMMON = 'common',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary',
}

export enum BindType {
  NONE = 'none',
  BIND_ON_PICKUP = 'bind_on_pickup',
  BIND_ON_USE = 'bind_on_use',
}

export enum BindStatus {
  UNBOUND = 'unbound',
  BOUND = 'bound',
}

export enum EquipmentSlot {
  WEAPON = 'weapon',
  HELMET = 'helmet',
  ARMOR = 'armor',
  BOOTS = 'boots',
  ACCESSORY = 'accessory',
}

export enum ItemChangeType {
  ADD = 'add',
  REMOVE = 'remove',
  TRADE = 'trade',
  DESTROY = 'destroy',
}

// ===== 世界场景模块枚举 =====

export enum SceneType {
  TOWN = 'town',
  DUNGEON = 'dungeon',
  ARENA = 'arena',
  WILD = 'wild',
}

export enum SceneStatus {
  OPEN = 'open',
  MAINTENANCE = 'maintenance',
}

export enum NpcInteractType {
  TALK = 'talk',
  SHOP = 'shop',
  QUEST = 'quest',
  TRANSPORT = 'transport',
}

export enum MonsterAiType {
  PATROL = 'patrol',
  GUARD = 'guard',
  ACTIVE = 'active',
}

export enum ObjectType {
  CHEST = 'chest',
  COLLECT = 'collect',
  STONE = 'stone',
  PLANT = 'plant',
}

export enum TriggerType {
  TRANSPORT = 'transport',
  STORY = 'story',
  BATTLE = 'battle',
  ACTIVITY = 'activity',
}

export enum EntityType {
  NPC = 'npc',
  MONSTER = 'monster',
  OBJECT = 'object',
}

export enum EntityState {
  IDLE = 'idle',
  MOVE = 'move',
  FIGHT = 'fight',
  DEAD = 'dead',
  CLOSED = 'closed',
  OPENED = 'opened',
}

// ===== 战斗技能模块枚举 =====

export enum SkillType {
  ACTIVE = 'active',
  PASSIVE = 'passive',
}

export enum CombatType {
  PVE = 'pve',
  PVP = 'pvp',
  GUILD_WAR = 'guild_war',
}

export enum CombatResult {
  WIN = 'win',
  LOSE = 'lose',
  DRAW = 'draw',
}

export enum BuffType {
  BUFF = 'buff',
  DEBUFF = 'debuff',
}

export enum BuffTarget {
  SELF = 'self',
  TARGET = 'target',
}

// ===== 任务模块枚举 =====

export enum QuestType {
  MAIN = 'main',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  ACHIEVEMENT = 'achievement',
}

export enum QuestStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CLAIMED = 'claimed',
}

// ===== 社交模块枚举 =====

export enum FriendStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  BLOCKED = 'blocked',
}

export enum GuildRole {
  LEADER = 'leader',
  OFFICER = 'officer',
  ELITE = 'elite',
  MEMBER = 'member',
}

export enum DonateType {
  GOLD = 'gold',
  DIAMOND = 'diamond',
  ITEM = 'item',
}

// ===== 邮件模块枚举 =====

export enum MailSenderType {
  SYSTEM = 'system',
  PLAYER = 'player',
  ADMIN = 'admin',
}

// ===== 聊天模块枚举 =====

export enum ChatChannel {
  WORLD = 'world',
  PRIVATE = 'private',
  GUILD = 'guild',
}

// ===== 公告模块枚举 =====

export enum NoticeType {
  POPUP = 'popup',
  BANNER = 'banner',
  LOGIN = 'login',
}

// ===== 排行榜模块枚举 =====

export enum RankingType {
  POWER = 'power',
  LEVEL = 'level',
  WEALTH = 'wealth',
}

// ===== 服务器状态枚举 =====

export enum ServerState {
  RUNNING = 'running',
  MAINTENANCE = 'maintenance',
  CLOSED = 'closed',
}

// ===== 活动系统枚举 =====

export enum ActivityType {
  LIMITED_TIME = 'limited_time',
  SIGN_IN = 'sign_in',
  LADDER = 'ladder',
}

export enum ActivityStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ENDED = 'ended',
}

export enum SignInCycle {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

// ===== 交易拍卖枚举 =====

export enum TradeStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum AuctionStatus {
  LISTED = 'listed',
  BID = 'bid',
  SOLD = 'sold',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

// ===== 成就系统枚举 =====

export enum AchievementCategory {
  COMBAT = 'combat',
  SOCIAL = 'social',
  ECONOMY = 'economy',
  EXPLORATION = 'exploration',
  SPECIAL = 'special',
}

export enum AchievementCondition {
  REACH_LEVEL = 'reach_level',
  KILL_COUNT = 'kill_count',
  COMPLETE_QUEST = 'complete_quest',
  EARN_CURRENCY = 'earn_currency',
  JOIN_GUILD = 'join_guild',
  ADD_FRIEND = 'add_friend',
  WIN_COMBAT = 'win_combat',
}

// ===== 数据统计枚举 =====

export enum BehaviorType {
  LOGIN = 'login',
  LOGOUT = 'logout',
  PURCHASE = 'purchase',
  LEVEL_UP = 'level_up',
  QUEST_COMPLETE = 'quest_complete',
  PVP_BATTLE = 'pvp_battle',
}

export enum StatPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

// ===== 配置管理枚举 =====

export enum ConfigType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  JSON = 'json',
}

// ===== 支付充值枚举 =====
export enum RechargeStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
}

// ===== 匹配模块枚举 =====
export enum MatchMode {
  RANKED = 'ranked',
  CASUAL = 'casual',
  PRACTICE = 'practice',
}
