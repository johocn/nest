import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EconomyService } from './economy.service';
import { Transaction } from './entities/transaction.entity';
import { PlayerService } from '@modules/player/player.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { CurrencyType, TransactionType } from '@constants/enums';

describe('EconomyService', () => {
  let service: EconomyService;

  const mockTxRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const mockPlayerService = {
    getCurrency: jest.fn(),
    saveCurrency: jest.fn(),
  };

  const mockCacheService = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true),
    withLock: jest.fn(),
  };

  const mockEventBus = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // withLock 默认行为：直接执行 callback
    mockCacheService.withLock.mockImplementation(
      async (_key: string, callback: () => Promise<any>) => callback(),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        EconomyService,
        { provide: getRepositoryToken(Transaction), useValue: mockTxRepo },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: EventBusService, useValue: mockEventBus },
      ],
    }).compile();
    service = moduleRef.get<EconomyService>(EconomyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should add currency successfully', async () => {
    const mockCurrency = {
      playerId: '1',
      currencyType: CurrencyType.GOLD,
      amount: '500',
    };
    mockPlayerService.getCurrency.mockResolvedValue(mockCurrency);
    mockPlayerService.saveCurrency.mockImplementation(async (c) => c);
    mockTxRepo.create.mockImplementation((data) => data);
    mockTxRepo.save.mockResolvedValue({ id: 'tx1' });

    const result = await service.addCurrency(
      '1',
      CurrencyType.GOLD,
      500,
      'admin',
      'gm',
    );

    expect(result.balanceAfter).toBe('1000');
    expect(mockPlayerService.saveCurrency).toHaveBeenCalled();
    expect(mockTxRepo.save).toHaveBeenCalled();
    expect(mockEventBus.emit).toHaveBeenCalled();
  });

  it('should deduct currency successfully', async () => {
    const mockCurrency = {
      playerId: '1',
      currencyType: CurrencyType.GOLD,
      amount: '1000',
    };
    mockPlayerService.getCurrency.mockResolvedValue(mockCurrency);
    mockPlayerService.saveCurrency.mockImplementation(async (c) => c);
    mockTxRepo.create.mockImplementation((data) => data);
    mockTxRepo.save.mockResolvedValue({ id: 'tx2' });

    const result = await service.deductCurrency(
      '1',
      CurrencyType.GOLD,
      300,
      'shop',
      'shop_buy',
    );

    expect(result.balanceAfter).toBe('700');
  });

  it('should throw if insufficient balance', async () => {
    const mockCurrency = {
      playerId: '1',
      currencyType: CurrencyType.GOLD,
      amount: '100',
    };
    mockPlayerService.getCurrency.mockResolvedValue(mockCurrency);

    await expect(
      service.deductCurrency('1', CurrencyType.GOLD, 500, 'shop', 'shop_buy'),
    ).rejects.toThrow(GameException);
  });

  it('should throw if currency record not found', async () => {
    mockPlayerService.getCurrency.mockResolvedValue(null);

    await expect(
      service.addCurrency('1', CurrencyType.GOLD, 500, 'admin', 'gm'),
    ).rejects.toThrow(GameException);
  });

  it('should get balance', async () => {
    mockPlayerService.getCurrency.mockResolvedValue({
      playerId: '1',
      currencyType: CurrencyType.GOLD,
      amount: '5000',
    });
    const balance = await service.getBalance('1', CurrencyType.GOLD);
    expect(balance).toBe('5000');
  });

  it('should return zero balance if no currency record', async () => {
    mockPlayerService.getCurrency.mockResolvedValue(null);
    const balance = await service.getBalance('1', CurrencyType.GOLD);
    expect(balance).toBe('0');
  });

  it('should get transaction history', async () => {
    const mockTxns = [
      { id: '1', playerId: '1', txType: TransactionType.EARN, amount: '500' },
      { id: '2', playerId: '1', txType: TransactionType.SPEND, amount: '-100' },
    ];
    mockTxRepo.find.mockResolvedValue(mockTxns);

    const result = await service.getTransactions('1', 1, 10);
    expect(result.items).toHaveLength(2);
  });
});
