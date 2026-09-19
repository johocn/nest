import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlayerService } from './player.service';
import { Player } from './entities/player.entity';
import { PlayerCurrency } from './entities/player-currency.entity';
import { ConfigService } from '@nestjs/config';
import { GameException } from '@common/exceptions/game.exception';
import { CurrencyType } from '@constants/enums';
import { EventBusService } from '@event-bus/event-bus.service';

describe('PlayerService', () => {
  let service: PlayerService;

  const mockPlayerRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    update: jest.fn(),
  };

  const mockCurrencyRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'game') return { initialGold: 1000, initialDiamond: 0 };
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlayerService,
        { provide: getRepositoryToken(Player), useValue: mockPlayerRepo },
        {
          provide: getRepositoryToken(PlayerCurrency),
          useValue: mockCurrencyRepo,
        },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get<PlayerService>(PlayerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a player with initial currency', async () => {
    mockPlayerRepo.findOne.mockResolvedValue(null);
    mockPlayerRepo.create.mockImplementation((data) => data);
    mockPlayerRepo.save.mockImplementation(async (data) => ({
      ...data,
      id: '1',
    }));
    mockCurrencyRepo.create.mockImplementation((data) => data);
    mockCurrencyRepo.save.mockResolvedValue({});

    const player = await service.createPlayer('acc-1', 'Hero');

    expect(player).toBeDefined();
    expect(player.nickname).toBe('Hero');
    expect(player.accountId).toBe('acc-1');
    expect(mockPlayerRepo.save).toHaveBeenCalledTimes(1);
    expect(mockCurrencyRepo.save).toHaveBeenCalledTimes(1);
    expect(mockCurrencyRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ currencyType: CurrencyType.GOLD, amount: '1000' }),
        expect.objectContaining({ currencyType: CurrencyType.DIAMOND, amount: '0' }),
        expect.objectContaining({ currencyType: CurrencyType.FAVOR, amount: '0' }),
        expect.objectContaining({
          currencyType: CurrencyType.GUILD_CONTRIB,
          amount: '0',
        }),
        expect.objectContaining({ currencyType: CurrencyType.FACE, amount: '0' }),
      ]),
    );
  });

  it('should throw if nickname already exists', async () => {
    mockPlayerRepo.findOne.mockResolvedValue({ id: '99', nickname: 'Hero' });
    await expect(service.createPlayer('acc-1', 'Hero')).rejects.toThrow(
      GameException,
    );
  });

  it('should get player by account id', async () => {
    const mockPlayer = { id: '1', accountId: 'acc-1', nickname: 'Hero' };
    mockPlayerRepo.findOne.mockResolvedValue(mockPlayer);
    const result = await service.getByAccountId('acc-1');
    expect(result).toEqual(mockPlayer);
  });

  it('should get base info with currencies', async () => {
    const mockPlayer = {
      id: '1',
      accountId: 'acc-1',
      nickname: 'Hero',
      level: 1,
    };
    const mockCurrencies = [
      { playerId: '1', currencyType: CurrencyType.GOLD, amount: '1000' },
      { playerId: '1', currencyType: CurrencyType.DIAMOND, amount: '0' },
    ];
    mockPlayerRepo.findOne.mockResolvedValue(mockPlayer);
    mockCurrencyRepo.find.mockResolvedValue(mockCurrencies);

    const result = await service.getBaseInfo('1');
    expect(result.player).toEqual(mockPlayer);
    expect(result.currencies).toHaveLength(2);
  });

  it('should throw if player not found in getBaseInfo', async () => {
    mockPlayerRepo.findOne.mockResolvedValue(null);
    await expect(service.getBaseInfo('999')).rejects.toThrow(GameException);
  });

  it('should change nickname', async () => {
    mockPlayerRepo.findOne.mockResolvedValueOnce(null);
    mockPlayerRepo.findOne.mockResolvedValueOnce({
      id: '1',
      nickname: 'OldName',
    });
    mockPlayerRepo.save.mockResolvedValue({ id: '1', nickname: 'NewName' });

    const result = await service.changeNickname('1', 'NewName');
    expect(result.nickname).toBe('NewName');
  });

  it('should throw if new nickname already taken', async () => {
    mockPlayerRepo.findOne.mockResolvedValue({ id: '2', nickname: 'Taken' });
    await expect(service.changeNickname('1', 'Taken')).rejects.toThrow(
      GameException,
    );
  });

  describe('addExp', () => {
    it('should add exp and level up when threshold reached', async () => {
      mockPlayerRepo.findOne.mockResolvedValue({
        id: 'p1',
        level: 3,
        exp: '500',
        vipLevel: 0,
        vipExp: 0,
      });
      mockPlayerRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.addExp('p1', 2800);

      expect(result.player.level).toBe(4);
      expect(result.leveledUp).toBe(true);
    });

    it('should not level up when exp below threshold', async () => {
      mockPlayerRepo.findOne.mockResolvedValue({
        id: 'p1',
        level: 5,
        exp: '100',
        vipLevel: 0,
        vipExp: 0,
      });
      mockPlayerRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.addExp('p1', 200);

      expect(result.player.level).toBe(5);
      expect(result.leveledUp).toBe(false);
    });
  });

  describe('addVipExp', () => {
    it('should add vip exp and level up', async () => {
      mockPlayerRepo.findOne.mockResolvedValue({
        id: 'p1',
        level: 1,
        exp: '0',
        vipLevel: 1,
        vipExp: 500,
      });
      mockPlayerRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.addVipExp('p1', 600);

      expect(result.vipLevel).toBe(2);
      expect(result.leveledUp).toBe(true);
    });
  });

  describe('addRecharge', () => {
    it('should add amount to totalRecharge using BigInt arithmetic', async () => {
      const mockPlayer = { id: '1', totalRecharge: '1000' };
      mockPlayerRepo.findOne.mockResolvedValue(mockPlayer);
      mockPlayerRepo.save.mockResolvedValue({
        ...mockPlayer,
        totalRecharge: '1500',
      });

      const result = await service.addRecharge('1', 500);
      expect(result.totalRecharge).toBe('1500');
      expect(mockPlayerRepo.save).toHaveBeenCalled();
    });
  });
});
