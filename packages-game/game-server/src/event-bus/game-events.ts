export const GameEvents = {
  // 战斗事件
  MONSTER_KILLED: 'combat.monster.killed',
  PLAYER_DIED: 'combat.player.died',

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

  // 成就事件
  ACHIEVEMENT_UNLOCKED: 'achievement.unlocked',
  ACHIEVEMENT_PROGRESS: 'achievement.progress',

  // 数据统计事件
  PLAYER_BEHAVIOR: 'analytics.behavior',

  // 配置事件
  CONFIG_UPDATED: 'config.updated',
} as const;

export type GameEvent = (typeof GameEvents)[keyof typeof GameEvents];
