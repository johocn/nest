import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BalanceAuditService } from './balance-audit.service';
import { Transaction } from '@modules/economy/entities/transaction.entity';
import { Friend } from '@modules/social/entities/friend.entity';
import { Kinship } from '@modules/social/entities/kinship.entity';
import { Player } from '@modules/player/entities/player.entity';
import { PlayerCurrency } from '@modules/player/entities/player-currency.entity';
import { CombatLog } from '@modules/combat/entities/combat-log.entity';
import {
  CurrencyType,
  CombatType,
  CombatResult,
  FriendStatus,
  KinshipStatus,
  TransactionType,
} from '@constants/enums';
import type { Repository } from 'typeorm';

describe('BalanceAuditService', () => {
  let service: BalanceAuditService;
  let txRepo: jest.Mocked<Repository<Transaction>>;
  let friendRepo: jest.Mocked<Repository<Friend>>;
  let kinshipRepo: jest.Mocked<Repository<Kinship>>;
  let playerRepo: jest.Mocked<Repository<Player>>;
  let currencyRepo: jest.Mocked<Repository<PlayerCurrency>>;
  let combatLogRepo: jest.Mocked<Repository<CombatLog>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceAuditService,
        { provide: getRepositoryToken(Transaction), useValue: { find: jest.fn(), createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(Friend), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Kinship), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Player), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(PlayerCurrency), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(CombatLog), useValue: { find: jest.fn() } },
      ],
    }).compile();

    service = module.get(BalanceAuditService);
    txRepo = module.get(getRepositoryToken(Transaction));
    friendRepo = module.get(getRepositoryToken(Friend));
    kinshipRepo = module.get(getRepositoryToken(Kinship));
    playerRepo = module.get(getRepositoryToken(Player));
    currencyRepo = module.get(getRepositoryToken(PlayerCurrency));
    combatLogRepo = module.get(getRepositoryToken(CombatLog));
  });

  describe('audit', () => {
    it('should report relation rate when new players have friends', async () => {
      playerRepo.find.mockResolvedValue([
        { id: '2', createdAt: new Date(), level: 1 } as Player,
        { id: '3', createdAt: new Date(), level: 2 } as Player,
      ]);
      friendRepo.find.mockResolvedValue([
        { playerId: '2', friendId: '1', status: FriendStatus.ACCEPTED } as Friend,
      ]);
      kinshipRepo.find.mockResolvedValue([]);
      txRepo.find.mockResolvedValue([]);
      txRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      } as any);
      currencyRepo.find.mockResolvedValue([]);
      combatLogRepo.find.mockResolvedValue([]);

      const report = await service.audit();

      expect(report.social.newPlayerCount).toBe(2);
      expect(report.social.relatedNewPlayerCount).toBe(1);
      expect(report.social.newPlayerRelationRate).toBe(50);
      expect(report.social.healthy).toBe(false);
      expect(report.combat.healthy).toBeNull();
      expect(report.economy.healthy).toBeNull();
      expect(report.health).toBe(false);
    });

    it('should be healthy when relation rate >= 60 and PVP win rate in 40-60', async () => {
      playerRepo.find.mockResolvedValue([
        { id: '2', createdAt: new Date(), level: 1 } as Player,
      ]);
      friendRepo.find.mockResolvedValue([
        { playerId: '2', friendId: '1', status: FriendStatus.ACCEPTED } as Friend,
      ]);
      kinshipRepo.find.mockResolvedValue([]);
      txRepo.find.mockResolvedValue([
        { currencyType: CurrencyType.FAVOR, amount: '10' } as Transaction,
        { currencyType: CurrencyType.FACE, amount: '-5' } as Transaction,
      ]);
      txRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ playerId: '2' }]),
      } as any);
      currencyRepo.find.mockResolvedValue([
        { currencyType: CurrencyType.GOLD, amount: '10000' } as PlayerCurrency,
      ]);
      txRepo.find.mockResolvedValue([
        { currencyType: CurrencyType.FAVOR, amount: '10' } as Transaction,
        { currencyType: CurrencyType.FACE, amount: '-5' } as Transaction,
      ]);
      combatLogRepo.find.mockResolvedValue([
        { result: CombatResult.WIN } as CombatLog,
        { result: CombatResult.LOSE } as CombatLog,
        { result: CombatResult.WIN } as CombatLog,
      ]);

      const report = await service.audit();

      expect(report.social.newPlayerRelationRate).toBe(100);
      expect(report.social.healthy).toBe(true);
      expect(report.social.socialCurrencyFlow.byCurrency.favor).toBe('10');
      expect(report.social.socialCurrencyFlow.byCurrency.face).toBe('5');
      expect(report.social.socialCurrencyFlow.total).toBe('15');
      expect(report.combat.pvpWinRate).toBe(67);
      expect(report.combat.healthy).toBe(false);
      expect(report.economy.goldStock).toBe('10000');
      expect(report.economy.healthy).toBe(true);
      expect(report.health).toBe(false); // combat 越界
    });

    it('should compute gold inflation rate', async () => {
      playerRepo.find.mockResolvedValue([]);
      friendRepo.find.mockResolvedValue([]);
      kinshipRepo.find.mockResolvedValue([]);
      txRepo.find.mockResolvedValue([
        {
          currencyType: CurrencyType.GOLD,
          txType: TransactionType.EARN,
          amount: '3000',
          createdAt: new Date(),
        } as Transaction,
      ]);
      txRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      } as any);
      currencyRepo.find.mockResolvedValue([
        { currencyType: CurrencyType.GOLD, amount: '10000' } as PlayerCurrency,
      ]);
      combatLogRepo.find.mockResolvedValue([]);

      const report = await service.audit();

      expect(report.economy.goldInflow30d).toBe('3000');
      expect(report.economy.monthlyInflationRate).toBe(30);
      expect(report.economy.healthy).toBe(true);
    });

    it('should build level distribution and avg hours per level', async () => {
      const createdAt = new Date(Date.now() - 48 * 3600 * 1000);
      playerRepo.find.mockResolvedValue([
        { id: '2', level: 2, createdAt } as Player,
        { id: '3', level: 5, createdAt } as Player,
      ]);
      friendRepo.find.mockResolvedValue([]);
      kinshipRepo.find.mockResolvedValue([]);
      txRepo.find.mockResolvedValue([]);
      txRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      } as any);
      currencyRepo.find.mockResolvedValue([]);
      combatLogRepo.find.mockResolvedValue([]);

      const report = await service.audit();

      expect(report.growth.playerCount).toBe(2);
      expect(report.growth.levelDistribution['2']).toBe(1);
      expect(report.growth.levelDistribution['5']).toBe(1);
      expect(report.growth.avgHoursPerLevel).toBe(14); // 48h*2/(2+5)
    });

    it('should treat kinship as relation for new players', async () => {
      playerRepo.find.mockResolvedValue([
        { id: '9', createdAt: new Date() } as Player,
      ]);
      friendRepo.find.mockResolvedValue([]);
      kinshipRepo.find.mockResolvedValue([
        {
          status: KinshipStatus.ACTIVE,
          members: ['9', '1'],
        } as Kinship,
      ]);
      txRepo.find.mockResolvedValue([]);
      txRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      } as any);
      currencyRepo.find.mockResolvedValue([]);
      combatLogRepo.find.mockResolvedValue([]);

      const report = await service.audit();

      expect(report.social.relatedNewPlayerCount).toBe(1);
      expect(report.social.newPlayerRelationRate).toBe(100);
      expect(report.social.healthy).toBe(true);
    });
  });
});
