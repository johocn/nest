export const GameEvents = {
  // 战斗事件
  MONSTER_KILLED: 'combat.monster.killed',
  PLAYER_DIED: 'combat.player.died',
  FORMATION_ACTIVATED: 'combat.formation.activated',
  COMBO_TRIGGERED: 'combat.combo.triggered',
  RESCUE_SUCCESS: 'combat.rescue.success',
  LOOT_DISTRIBUTED: 'combat.loot.distributed',
  BATTLE_REPORTED: 'combat.battle.reported',
  ARBITRATION_SETTLED: 'combat.arbitration.settled',
  GRUDGE_DECLARED: 'combat.grudge.declared',

  // 经济事件
  CURRENCY_CHANGED: 'economy.currency.changed',
  ITEM_ACQUIRED: 'inventory.item.acquired',
  ITEM_CONSUMED: 'inventory.item.consumed',

  // 角色事件
  LEVEL_UP: 'player.level.up',
  VIP_LEVEL_UP: 'player.vip.level_up',
  RECHARGE_SUCCESS: 'payment.recharge.success',
  MATCH_SUCCESS: 'matchmaking.match.success',
  PLAYER_OFFLINE_SYNC: 'player.offline.sync',
  PLAYER_OFFLINE_SAVED: 'player.offline.saved',
  POWER_CHANGED: 'character.power.changed',

  // 社交事件
  GUILD_JOINED: 'social.guild.joined',
  FRIEND_ADDED: 'social.friend.added',
  GIFT_SENT: 'social.gift.sent',
  FAVOR_GAINED: 'economy.favor.gained',
  GUILD_CONTRIB_GAINED: 'economy.guild_contrib.gained',
  FACE_CHANGED: 'economy.face.changed',
  INTEL_GAINED: 'social.intel.gained',
  INTEL_BOUGHT: 'social.intel.bought',
  INTEL_SOLD: 'social.intel.sold',
  RELATIONSHIP_LEVEL_UP: 'social.relationship.level_up',
  KINSHIP_FORMED: 'social.kinship.formed',
  KINSHIP_BROKEN: 'social.kinship.broken',

  // 世界事件
  ENTITY_SPAWNED: 'world.entity.spawned',
  ENTITY_REMOVED: 'world.entity.removed',

  // 网关事件
  PLAYER_ONLINE: 'gateway.player.online',
  PLAYER_OFFLINE: 'gateway.player.offline',
  PLAYER_ENTER_SCENE: 'world.player.enter_scene',
  PLAYER_LEAVE_SCENE: 'world.player.leave_scene',

  // 任务事件
  QUEST_ACCEPTED: 'quest.accepted',
  QUEST_COMPLETED: 'quest.completed',

  // 邮件事件
  MAIL_RECEIVED: 'mail.received',

  // 公会事件
  GUILD_DONATED: 'social.guild.donated',
  GUILD_ROLE_CHANGED: 'social.guild.role_changed',
  GUILD_FUND_CHANGED: 'social.guild.fund_changed',
  GUILD_DIPLOMACY_CHANGED: 'social.guild.diplomacy_changed',
  GUILD_IMPEACHMENT: 'social.guild.impeachment',

  // 聊天事件
  CHAT_WORLD: 'chat.world',
  CHAT_PRIVATE: 'chat.private',
  CHAT_GUILD: 'chat.guild',

  // 活动事件
  ACTIVITY_STARTED: 'activity.started',
  ACTIVITY_ENDED: 'activity.ended',
  SIGN_IN_COMPLETED: 'activity.sign_in',

  // 交易拍卖事件
  TRADE_CREATED: 'trade.created',
  TRADE_COMPLETED: 'trade.completed',
  AUCTION_LISTED: 'auction.listed',
  AUCTION_BID: 'auction.bid',
  AUCTION_SOLD: 'auction.sold',
  NEGOTIATION_COMPLETED: 'trade.negotiation.completed',
  ESCROW_RELEASED: 'trade.escrow.released',
  BOUNTY_PUBLISHED: 'trade.bounty.published',
  BOUNTY_COMPLETED: 'trade.bounty.completed',
  CREDIT_SETTLED: 'trade.credit.settled',
  BARTER_COMPLETED: 'trade.barter.completed',

  // 成就事件
  ACHIEVEMENT_UNLOCKED: 'achievement.unlocked',
  ACHIEVEMENT_PROGRESS: 'achievement.progress',

  // 数据统计事件
  PLAYER_BEHAVIOR: 'analytics.behavior',

  // 生态事件
  ECO_ACTION: 'eco.action',

  // 配置事件
  CONFIG_UPDATED: 'config.updated',

  // 社区运营事件（13.7）
  NOTICE_REACTED: 'notice.reacted',
  FEEDBACK_SUBMITTED: 'community.feedback.submitted',
  AMBASSADOR_APPOINTED: 'community.ambassador.appointed',
  REPORT_SUBMITTED: 'community.report.submitted',
  PLAYER_BLOCKED: 'social.player.blocked',

  // 聊天深化事件（14.8-14.12）
  CHAT_SIGN_IN: 'chat.sign_in',
  LUCKY_STAR_DRAWN: 'chat.lucky_star.drawn',
  SUPPORT_TICKET_CREATED: 'support.ticket.created',
  VOICE_ROOM_JOINED: 'voice.room.joined',
  VOICE_ROOM_LEFT: 'voice.room.left',
} as const;

export type GameEvent = (typeof GameEvents)[keyof typeof GameEvents];
