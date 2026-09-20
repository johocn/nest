import { GuildRole, IntelligenceGrade, RelationshipLevel } from './enums';

/** 情报等级档位（用于「情报等级 ≥ X」类门槛比较） */
export const INTEL_GRADE_RANKS: Record<string, number> = {
  [IntelligenceGrade.E]: 0,
  [IntelligenceGrade.D]: 1,
  [IntelligenceGrade.C]: 2,
  [IntelligenceGrade.B]: 3,
  [IntelligenceGrade.A]: 4,
};

/** 好感档位（用于「好感 ≥ X 档」类门槛比较） */
export const FAVOR_RANKS: Record<string, number> = {
  [RelationshipLevel.STRANGER]: 0,
  [RelationshipLevel.ACQUAINTANCE]: 1,
  [RelationshipLevel.FRIEND]: 2,
  [RelationshipLevel.CONFIDANT]: 3,
  [RelationshipLevel.SWORN]: 4,
};

/** 帮派职位档位（用于「帮派职位 ≥ X」类门槛比较） */
export const GUILD_ROLE_RANKS: Record<string, number> = {
  [GuildRole.MEMBER]: 0,
  [GuildRole.OFFICER]: 0,
  [GuildRole.ELITE]: 0,
  [GuildRole.INCENSE_MASTER]: 1,
  [GuildRole.HALL_MASTER]: 2,
  [GuildRole.VICE_LEADER]: 3,
  [GuildRole.LEADER]: 4,
};

/** 好感原始值 → 档位（关系表无 level 列时的兜底换算） */
export function favorRankOf(favorability: number): number {
  if (favorability >= 500) return 4;
  if (favorability >= 300) return 3;
  if (favorability >= 150) return 2;
  if (favorability >= 50) return 1;
  return 0;
}
