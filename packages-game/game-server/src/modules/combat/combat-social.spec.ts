import {
  FormationType,
  CombatMode,
  LootDistributionMode,
  ArbitrationStatus,
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import {
  Formation,
  FormationBinding,
  RescueLog,
  CombatLootLog,
  CombatArbitration,
} from './entities';

describe('Social Combat Domain Contracts', () => {
  it('should expose formation combat enums', () => {
    expect(FormationType.THREE_TALENTS).toBe('three_talents');
    expect(FormationType.FIVE_ELEMENTS).toBe('five_elements');
    expect(FormationType.BEIDOU).toBe('beidou');
    expect(CombatMode.POINTS_TO_STOP).toBe('points_to_stop');
    expect(CombatMode.DEATH_MATCH).toBe('death_match');
    expect(LootDistributionMode.CONTRIBUTION).toBe('contribution');
    expect(LootDistributionMode.ROLL).toBe('roll');
    expect(LootDistributionMode.CAPTAIN).toBe('captain');
    expect(LootDistributionMode.EQUAL).toBe('equal');
    expect(ArbitrationStatus.PENDING).toBe('pending');
    expect(ArbitrationStatus.SUCCESS).toBe('success');
    expect(ArbitrationStatus.FAIL).toBe('fail');
  });

  it('should expose combat domain error codes', () => {
    expect(ErrorCodes.FORMATION_NOT_FOUND).toBe(91301);
    expect(ErrorCodes.FORMATION_POSITION_TAKEN).toBe(91302);
    expect(ErrorCodes.FORMATION_MEMBER_LIMIT).toBe(91303);
    expect(ErrorCodes.FORMATION_ACTIVE).toBe(91304);
    expect(ErrorCodes.TACIT_NOT_ENOUGH).toBe(91306);
    expect(ErrorCodes.RESCUE_DAILY_CAP).toBe(91307);
    expect(ErrorCodes.RESCUE_TARGET_INVALID).toBe(91308);
    expect(ErrorCodes.LOOT_NOT_FOUND).toBe(91309);
    expect(ErrorCodes.ARBITRATION_EXISTS).toBe(91311);
    expect(ErrorCodes.ARBITRATION_NOT_READY).toBe(91312);
    expect(ErrorCodes.SHAME_TARGET_INVALID).toBe(91313);
  });

  it('should expose combat events', () => {
    expect(GameEvents.FORMATION_ACTIVATED).toBe('combat.formation.activated');
    expect(GameEvents.COMBO_TRIGGERED).toBe('combat.combo.triggered');
    expect(GameEvents.RESCUE_SUCCESS).toBe('combat.rescue.success');
    expect(GameEvents.LOOT_DISTRIBUTED).toBe('combat.loot.distributed');
    expect(GameEvents.BATTLE_REPORTED).toBe('combat.battle.reported');
    expect(GameEvents.ARBITRATION_SETTLED).toBe('combat.arbitration.settled');
    expect(GameEvents.GRUDGE_DECLARED).toBe('combat.grudge.declared');
  });

  it('should expose new entity classes', () => {
    const entities = [
      Formation,
      FormationBinding,
      RescueLog,
      CombatLootLog,
      CombatArbitration,
    ];
    for (const entity of entities) {
      expect(typeof entity).toBe('function');
    }
  });
});
