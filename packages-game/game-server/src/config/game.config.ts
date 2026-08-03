import { registerAs } from '@nestjs/config';

export interface GameConfig {
  initialGold: number;
  initialDiamond: number;
  bagMaxSlots: number;
  dailyQuestLimit: number;
  wsHeartbeatInterval: number;
  wsPingTimeout: number;
  viewportRadius: number;
}

export default registerAs(
  'game',
  (): GameConfig => ({
    initialGold: parseInt(process.env.GAME_INITIAL_GOLD || '1000', 10),
    initialDiamond: parseInt(process.env.GAME_INITIAL_DIAMOND || '0', 10),
    bagMaxSlots: parseInt(process.env.GAME_BAG_MAX_SLOTS || '100', 10),
    dailyQuestLimit: parseInt(process.env.GAME_DAILY_QUEST_LIMIT || '10', 10),
    wsHeartbeatInterval: parseInt(
      process.env.GAME_WS_HEARTBEAT_INTERVAL || '30000',
      10,
    ),
    wsPingTimeout: parseInt(process.env.GAME_WS_PING_TIMEOUT || '90000', 10),
    viewportRadius: parseInt(process.env.GAME_VIEWPORT_RADIUS || '800', 10),
  }),
);
