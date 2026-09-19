export enum AccountType {
  NORMAL = 'normal',
  GUEST = 'guest',
  WECHAT = 'wechat',
  GOOGLE = 'google',
  SSO = 'sso',
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
  FAVOR = 'favor', // 人情值
  GUILD_CONTRIB = 'guild_contrib', // 帮贡
  FACE = 'face', // 颜面
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
  FRIEND = 'friend',
  CONFIDANT = 'confidant',
  SWORN = 'sworn',
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
  LANDMARK = 'landmark',
}

export enum TriggerType {
  TRANSPORT = 'transport',
  STORY = 'story',
  BATTLE = 'battle',
  ACTIVITY = 'activity',
  PUZZLE = 'puzzle',
  GATE = 'gate',
  TRAP = 'trap',
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

export enum InteractType {
  COLLECT = 'collect',
  HIDE = 'hide',
  CAMP = 'camp',
  SIT = 'sit',
  LIE = 'lie',
  CARVE = 'carve',
  READ = 'read',
  MOUNT = 'mount',
  FISH = 'fish',
  PLAY = 'play',
}

export enum GameType {
  FISHING = 'fishing',
  CHESS = 'chess',
  ARCHERY = 'archery',
  CRICKET = 'cricket',
  RING = 'ring',
}

export enum GameSessionStatus {
  OPEN = 'open',
  PLAYING = 'playing',
  FINISHED = 'finished',
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

export enum PenaltyLevel {
  WARNING = 'warning',
  MUTE = 'mute',
  GUILD_REMOVE = 'guild_remove',
  TRADE_LIMIT = 'trade_limit',
  BAN = 'ban',
}

export enum GuildRole {
  LEADER = 'leader',
  OFFICER = 'officer',
  ELITE = 'elite',
  MEMBER = 'member',
  VICE_LEADER = 'vice_leader',
  HALL_MASTER = 'hall_master',
  INCENSE_MASTER = 'incense_master',
}

export enum DonateType {
  GOLD = 'gold',
  DIAMOND = 'diamond',
  ITEM = 'item',
}

export enum IntelligenceGrade {
  E = 'E',
  D = 'D',
  C = 'C',
  B = 'B',
  A = 'A',
}

export enum IntelType {
  RUMOR = 'rumor',
  SECRET = 'secret',
}

export enum IntelSourceType {
  SPY = 'spy',
  INQUIRE = 'inquire',
  EAVESDROP = 'eavesdrop',
  MARKET = 'market',
}

export enum IntelStatus {
  ACTIVE = 'active',
  LISTED = 'listed',
  SOLD = 'sold',
  EXPIRED = 'expired',
  CONSUMED = 'consumed',
}

export enum KinshipType {
  SWORN = 'sworn',
  MASTER = 'master',
  COUPLE = 'couple',
}

export enum KinshipStatus {
  ACTIVE = 'active',
  DISBANDED = 'disbanded',
}

export enum GuildBuildingType {
  MEETING_HALL = 'meeting_hall',
  TRAINING_ROOM = 'training_room',
  SCRIPTURE_LIBRARY = 'scripture_library',
  BLACKSMITH = 'blacksmith',
  HERB_GARDEN = 'herb_garden',
}

export enum GuildActivityType {
  BANQUET = 'banquet',
  QUIZ = 'quiz',
  INSTANCE = 'instance',
  EXPEDITION = 'expedition',
}

export enum GuildActivityStatus {
  SCHEDULED = 'scheduled',
  ACTIVE = 'active',
  ENDED = 'ended',
}

export enum GuildDiplomacyRelation {
  FRIENDLY = 'friendly',
  NEUTRAL = 'neutral',
  HOSTILE = 'hostile',
}

export enum GuildShopRewardType {
  SKILL_POINT = 'skill_point',
  RESOURCE_PACK = 'resource_pack',
  TITLE = 'title',
}

export enum GuildImpeachmentStatus {
  PENDING = 'pending',
  DONE = 'done',
  REJECTED = 'rejected',
}

export enum GuildFundType {
  INCOME = 'income',
  EXPENSE = 'expense',
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

// ===== 社区运营枚举（13.7）=====

export enum NoticeReactionType {
  LIKE = 'like',
  ACK = 'ack',
}

export enum FeedbackCategory {
  SUGGESTION = 'suggestion',
  BUG = 'bug',
}

export enum FeedbackStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  DONE = 'done',
}

export enum AmbassadorStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

// ===== 聊天深化枚举（14.8-14.12）=====

export enum SupportTicketStatus {
  AUTO_REPLIED = 'auto_replied',
  NEEDS_GM = 'needs_gm',
  RESOLVED = 'resolved',
}

export enum VoiceRoomType {
  TEA_HOUSE = 'tea_house',
  GUILD = 'guild',
  PRIVATE = 'private',
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
  CHANNEL = 'channel', // 频道活动（彩蛋口令类，14.8③）
}

export enum ActivityStatus {
  DRAFT = 'draft',
  GRAY = 'gray', // 灰度中（白名单可见）
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

// ===== 社交战斗枚举 =====

export enum FormationType {
  THREE_TALENTS = 'three_talents',
  FIVE_ELEMENTS = 'five_elements',
  BEIDOU = 'beidou',
}

export enum CombatMode {
  POINTS_TO_STOP = 'points_to_stop',
  DEATH_MATCH = 'death_match',
}

export enum LootDistributionMode {
  CONTRIBUTION = 'contribution',
  ROLL = 'roll',
  CAPTAIN = 'captain',
  EQUAL = 'equal',
}

export enum ArbitrationStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAIL = 'fail',
}

// ===== 社交任务枚举 =====

export enum SocialTargetType {
  SPY = 'spy',
  INQUIRE = 'inquire',
  EAVESDROP = 'eavesdrop',
  SEND_GIFT = 'send_gift',
  RECIPROCATE_GIFT = 'reciprocate_gift',
  ACCEPT_FRIEND = 'accept_friend',
  FORM_KINSHIP = 'form_kinship',
  DONATE_GUILD = 'donate_guild',
  JOIN_GUILD = 'join_guild',
  INTEL_BUY = 'intel_buy',
  // 游戏内补充
  FORM_FORMATION = 'form_formation',
  ACTIVATE_FORMATION = 'activate_formation',
  PERFORM_COMBO = 'perform_combo',
  RESCUE_SUCCESS = 'rescue_success',
  LOOT_DISTRIBUTED = 'loot_distributed',
  ARBITRATION_SETTLED = 'arbitration_settled',
  NEGOTIATION_DONE = 'negotiation_done',
  ESCROW_RELEASED = 'escrow_released',
  BOUNTY_PUBLISHED = 'bounty_published',
  BOUNTY_COMPLETED = 'bounty_completed',
  CREDIT_REPAID = 'credit_repaid',
  BARTER_DONE = 'barter_done',
  // 生态域
  VIEW_ARTICLE = 'view_article',
  VIEW_COURSE = 'view_course',
  VIEW_PRODUCT = 'view_product',
  VIEW_PRICE = 'view_price',
  VIEW_ACTIVITY = 'view_activity',
  JOIN_ACTIVITY = 'join_activity',
  LIKE = 'like',
  COMMENT = 'comment',
  PURCHASE = 'purchase',
  DISTRIBUTE = 'distribute',
}

export enum QuestHelpStatus {
  OPEN = 'open',
  HELPED = 'helped',
  CLOSED = 'closed',
}

// ===== 社交经济枚举 =====

export enum NegotiationStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  LOCKED = 'locked',
}

export enum EscrowStatus {
  PENDING = 'pending',
  RELEASED = 'released',
  PENALIZED = 'penalized',
  CANCELLED = 'cancelled',
}

export enum BountyStatus {
  ACTIVE = 'active',
  ACCEPTED = 'accepted',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

export enum CreditStatus {
  ACTIVE = 'active',
  SETTLED = 'settled',
  DEFAULTED = 'defaulted',
  OVERDUE = 'overdue',
}

export enum BarterStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

// ===== 社交治理枚举 =====

export enum ReportTargetType {
  PLAYER = 'player',
  CHAT_MESSAGE = 'chat_message',
  GUILD = 'guild',
}

export enum ReportReason {
  ABUSE = 'abuse',
  AD = 'ad',
  FRAUD = 'fraud',
  CHEAT = 'cheat',
  OTHER = 'other',
}

export enum ReportStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  IGNORED = 'ignored',
}
