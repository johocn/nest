import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SocialService } from './social.service';
import {
  Friend,
  Guild,
  GuildMember,
  GuildDonate,
  GuildImpeachment,
  GuildBuilding,
  GuildFundLog,
  GuildActivity,
  GuildDiplomacy,
  Intelligence,
  GiftTemplate,
  Kinship,
} from './entities';
import { CharacterEspionage } from '@modules/character/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { PlayerService } from '@modules/player/player.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { CacheService } from '@cache/cache.service';
import { EconomyService } from '@modules/economy/economy.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import {
  FriendStatus,
  GuildRole,
  DonateType,
  GuildBuildingType,
  GuildFundType,
  IntelligenceGrade,
  IntelType,
  IntelSourceType,
  IntelStatus,
  CurrencyType,
  RelationshipLevel,
  KinshipType,
  KinshipStatus,
  GuildImpeachmentStatus,
  GuildActivityType,
  GuildActivityStatus,
  GuildDiplomacyRelation,
  GuildShopRewardType,
} from '@constants/enums';
import type { Repository } from 'typeorm';

describe('SocialService', () => {
  let service: SocialService;
  let friendRepo: jest.Mocked<Repository<Friend>>;
  let guildRepo: jest.Mocked<Repository<Guild>>;
  let guildMemberRepo: jest.Mocked<Repository<GuildMember>>;
  let guildDonateRepo: jest.Mocked<Repository<GuildDonate>>;
  let intelligenceRepo: jest.Mocked<Repository<Intelligence>>;
  let giftRepo: jest.Mocked<Repository<GiftTemplate>>;
  let kinshipRepo: jest.Mocked<Repository<Kinship>>;
  let impeachmentRepo: jest.Mocked<Repository<GuildImpeachment>>;
  let buildingRepo: jest.Mocked<Repository<GuildBuilding>>;
  let fundLogRepo: jest.Mocked<Repository<GuildFundLog>>;
  let activityRepo: jest.Mocked<Repository<GuildActivity>>;
  let diplomacyRepo: jest.Mocked<Repository<GuildDiplomacy>>;
  let espionageRepo: jest.Mocked<Repository<CharacterEspionage>>;
  let cacheService: jest.Mocked<CacheService>;
  let economyService: jest.Mocked<EconomyService>;
  let characterService: jest.Mocked<CharacterService>;
  let inventoryService: jest.Mocked<InventoryService>;
  let playerService: jest.Mocked<PlayerService>;
  let eventBus: jest.Mocked<EventBusService>;
  let random: jest.Mock<number>;

  beforeEach(async () => {
    random = jest.fn(() => 0);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialService,
        {
          provide: getRepositoryToken(Friend),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Guild),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(GuildMember),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(GuildDonate),
          useValue: {
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(GuildImpeachment),
          useValue: {
            findOne: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(GuildBuilding),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(GuildFundLog),
          useValue: {
            find: jest.fn(),
            findAndCount: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(GuildActivity),
          useValue: {
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(GuildDiplomacy),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        {
          provide: getRepositoryToken(Intelligence),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(GiftTemplate),
          useValue: {
            findOne: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(Kinship),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: getRepositoryToken(CharacterEspionage),
          useValue: {
            findOne: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: CacheService,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
        {
          provide: EconomyService,
          useValue: {
            addCurrency: jest.fn(),
            deductCurrency: jest.fn(),
          },
        },
        {
          provide: CharacterService,
          useValue: {
            increaseFavorability: jest.fn(),
            getRelationshipLevel: jest.fn(),
            getRelationships: jest.fn(),
          },
        },
        {
          provide: InventoryService,
          useValue: { removeItem: jest.fn() },
        },
        {
          provide: PlayerService,
          useValue: { getById: jest.fn() },
        },
        { provide: Function, useValue: random },
      ],
    }).compile();

    service = module.get(SocialService);
    friendRepo = module.get(getRepositoryToken(Friend));
    guildRepo = module.get(getRepositoryToken(Guild));
    guildMemberRepo = module.get(getRepositoryToken(GuildMember));
    guildDonateRepo = module.get(getRepositoryToken(GuildDonate));
    intelligenceRepo = module.get(getRepositoryToken(Intelligence));
    giftRepo = module.get(getRepositoryToken(GiftTemplate));
    kinshipRepo = module.get(getRepositoryToken(Kinship));
    impeachmentRepo = module.get(getRepositoryToken(GuildImpeachment));
    buildingRepo = module.get(getRepositoryToken(GuildBuilding));
    fundLogRepo = module.get(getRepositoryToken(GuildFundLog));
    activityRepo = module.get(getRepositoryToken(GuildActivity));
    diplomacyRepo = module.get(getRepositoryToken(GuildDiplomacy));
    espionageRepo = module.get(getRepositoryToken(CharacterEspionage));
    cacheService = module.get(CacheService);
    economyService = module.get(EconomyService);
    characterService = module.get(CharacterService);
    inventoryService = module.get(InventoryService);
    playerService = module.get(PlayerService);
    eventBus = module.get(EventBusService);
  });

  describe('applyFriend', () => {
    it('should create friend request with pending status', async () => {
      friendRepo.findOne.mockResolvedValue(null);

      const result = await service.applyFriend('p1', 'p2');

      expect(result.status).toBe(FriendStatus.PENDING);
      expect(friendRepo.save).toHaveBeenCalled();
    });

    it('should throw when already friends', async () => {
      friendRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        friendId: 'p2',
        status: FriendStatus.ACCEPTED,
        remark: null,
        lastChatTime: null,
        createdAt: new Date(),
      } as Friend);

      await expect(service.applyFriend('p1', 'p2')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('acceptFriend', () => {
    it('should update status to accepted', async () => {
      friendRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p2',
        friendId: 'p1',
        status: FriendStatus.PENDING,
        remark: null,
        lastChatTime: null,
        createdAt: new Date(),
      } as Friend);

      const result = await service.acceptFriend('p1', 'p2');

      expect(result.status).toBe(FriendStatus.ACCEPTED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'social.friend.added',
        expect.any(Object),
      );
    });

    it('should throw when no pending request', async () => {
      friendRepo.findOne.mockResolvedValue(null);

      await expect(service.acceptFriend('p1', 'p2')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('getFriendList', () => {
    it('should return accepted friends', async () => {
      friendRepo.find.mockResolvedValue([
        {
          id: '1',
          playerId: 'p1',
          friendId: 'p2',
          status: FriendStatus.ACCEPTED,
          remark: null,
          lastChatTime: null,
          createdAt: new Date(),
        } as Friend,
      ]);

      const result = await service.getFriendList('p1');

      expect(result).toHaveLength(1);
    });
  });

  describe('removeFriend', () => {
    it('should delete friend record', async () => {
      await service.removeFriend('p1', 'p2');

      expect(friendRepo.delete).toHaveBeenCalled();
    });
  });

  describe('createGuild', () => {
    it('should create guild and add leader as member', async () => {
      guildRepo.findOne.mockResolvedValue(null);
      guildMemberRepo.findOne.mockResolvedValue(null);

      const result = await service.createGuild('p1', '天下会');

      expect(result.name).toBe('天下会');
      expect(guildMemberRepo.save).toHaveBeenCalled();
    });

    it('should throw when guild name already exists', async () => {
      guildRepo.findOne.mockResolvedValue({
        id: '1',
        name: '天下会',
        leaderId: 'p2',
        level: 1,
        memberCount: 1,
        guildIcon: null,
        guildBuff: {},
        announcement: null,
        createdAt: new Date(),
        disbandedAt: null,
      } as Guild);

      await expect(service.createGuild('p1', '天下会')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when player already in a guild', async () => {
      guildRepo.findOne.mockResolvedValue(null);
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1',
        guildId: '2',
        playerId: 'p1',
        role: GuildRole.MEMBER,
        contribution: 0,
        joinedAt: new Date(),
      } as GuildMember);

      await expect(service.createGuild('p1', '天下会')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('joinGuild', () => {
    it('should add player as member', async () => {
      guildRepo.findOne.mockResolvedValue({
        id: '1',
        name: '天下会',
        leaderId: 'p2',
        level: 1,
        memberCount: 5,
        guildIcon: null,
        guildBuff: {},
        announcement: null,
        createdAt: new Date(),
        disbandedAt: null,
      } as Guild);
      guildMemberRepo.findOne.mockResolvedValue(null);

      const result = await service.joinGuild('p1', '1');

      expect(result.role).toBe(GuildRole.MEMBER);
    });

    it('should throw when guild not found', async () => {
      guildRepo.findOne.mockResolvedValue(null);

      await expect(service.joinGuild('p1', '999')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('getGuildInfo', () => {
    it('should return guild details', async () => {
      guildRepo.findOne.mockResolvedValue({
        id: '1',
        name: '天下会',
        leaderId: 'p1',
        level: 5,
        memberCount: 30,
        guildIcon: 'icon1',
        guildBuff: { attack: 10 },
        announcement: '欢迎',
        createdAt: new Date(),
        disbandedAt: null,
      } as Guild);

      const result = await service.getGuildInfo('1');

      expect(result?.name).toBe('天下会');
      expect(result?.level).toBe(5);
    });
  });

  describe('getGuildMembers', () => {
    it('should return all members', async () => {
      guildMemberRepo.find.mockResolvedValue([
        {
          id: '1',
          guildId: '1',
          playerId: 'p1',
          role: GuildRole.LEADER,
          contribution: 100,
          joinedAt: new Date(),
        } as GuildMember,
      ]);

      const result = await service.getGuildMembers('1');

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(GuildRole.LEADER);
    });
  });

  describe('donateToGuild', () => {
    it('should record donation and update contribution', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1',
        guildId: '1',
        playerId: 'p1',
        role: GuildRole.MEMBER,
        contribution: 50,
        joinedAt: new Date(),
      } as GuildMember);
      guildRepo.findOne.mockResolvedValue({ id: '1', fund: '0' } as any);
      guildRepo.save = jest.fn().mockImplementation((g: any) => Promise.resolve(g));
      economyService.addCurrency.mockResolvedValue({ balanceAfter: '1' });

      const result = await service.donateToGuild(
        'p1',
        '1',
        DonateType.GOLD,
        '1000',
      );

      expect(result.contributionGained).toBeGreaterThan(0);
      expect(guildDonateRepo.save).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'social.guild.donated',
        expect.any(Object),
      );
    });
  });

  // ===== Intelligence: spy =====

  describe('spyIntelligence', () => {
    it('creates intel and sets cooldown on success (no espionage record -> level 0)', async () => {
      espionageRepo.findOne.mockResolvedValue(null);
      random.mockReturnValue(0);

      const result = await service.spyIntelligence('p1', 'c2');

      expect(result.status).toBe(IntelStatus.ACTIVE);
      expect([IntelligenceGrade.C, IntelligenceGrade.D]).toContain(
        result.grade,
      );
      expect(result.intelType).toBe(IntelType.RUMOR);
      expect(result.sourceType).toBe(IntelSourceType.SPY);
      expect(result.sourceId).toBe('c2');
      expect(result.freshnessExpireAt).toBeInstanceOf(Date);
      expect(cacheService.set).toHaveBeenCalledWith('intel:spy:p1', '1', 600);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.INTEL_GAINED,
        expect.any(Object),
      );
      expect(espionageRepo.save).not.toHaveBeenCalled();
    });

    it('throws INTEL_COOLDOWN when in cooldown', async () => {
      cacheService.get.mockResolvedValue('1');

      await expect(service.spyIntelligence('p1', 'c2')).rejects.toMatchObject({
        response: { code: ErrorCodes.INTEL_COOLDOWN },
      });
      expect(espionageRepo.findOne).not.toHaveBeenCalled();
      expect(intelligenceRepo.create).not.toHaveBeenCalled();
    });

    it('throws INTEL_SPY_FAILED on failure and does not create intel', async () => {
      espionageRepo.findOne.mockResolvedValue(null);
      random.mockReturnValue(1);

      await expect(service.spyIntelligence('p1', 'c2')).rejects.toMatchObject({
        response: { code: ErrorCodes.INTEL_SPY_FAILED },
      });
      expect(intelligenceRepo.create).not.toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('accumulates +10 intelligenceValue and levels up across threshold (95->105, level 0->1)', async () => {
      const record = {
        id: '1',
        characterId: 'p1',
        canSpy: true,
        canInfiltrate: false,
        espionageLevel: 0,
        intelligenceValue: 95,
        currentMission: null,
        disguise: null,
        counterSpyLevel: 0,
      } as CharacterEspionage;
      espionageRepo.findOne.mockImplementation((opts: any) =>
        opts.where.characterId === 'p1'
          ? Promise.resolve(record)
          : Promise.resolve(null),
      );
      random.mockReturnValue(0);

      await service.spyIntelligence('p1', 'c2');

      expect(record.intelligenceValue).toBe(105);
      expect(record.espionageLevel).toBe(1);
      expect(espionageRepo.save).toHaveBeenCalledWith(record);
    });
  });

  // ===== Intelligence: inquire =====

  describe('inquireIntelligence', () => {
    it('deducts 100 gold and produces D-grade intel', async () => {
      economyService.deductCurrency.mockResolvedValue({ balanceAfter: '0' });
      espionageRepo.findOne.mockResolvedValue(null);

      const result = await service.inquireIntelligence('p1', '某某传闻');

      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GOLD,
        100,
        'inquire',
        'intel_inquire',
      );
      expect(result.grade).toBe(IntelligenceGrade.D);
      expect(result.sourceType).toBe(IntelSourceType.INQUIRE);
      expect(result.title).toBe('打听：某某传闻');
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.INTEL_GAINED,
        expect.any(Object),
      );
    });

    it('propagates CURRENCY_NOT_ENOUGH when gold insufficient', async () => {
      economyService.deductCurrency.mockRejectedValue(
        new GameException(ErrorCodes.CURRENCY_NOT_ENOUGH, '货币不足'),
      );

      await expect(
        service.inquireIntelligence('p1', 'x'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.CURRENCY_NOT_ENOUGH },
      });
    });
  });

  // ===== Intelligence: eavesdrop =====

  describe('eavesdropIntelligence', () => {
    it('throws INTEL_LEVEL_NOT_ENOUGH when espionage level < 5', async () => {
      espionageRepo.findOne.mockResolvedValue({
        id: '1',
        characterId: 'p1',
        espionageLevel: 3,
        canInfiltrate: true,
      } as CharacterEspionage);

      await expect(
        service.eavesdropIntelligence('p1', 'c2'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INTEL_LEVEL_NOT_ENOUGH },
      });
    });

    it('throws INTEL_LEVEL_NOT_ENOUGH when canInfiltrate is false', async () => {
      espionageRepo.findOne.mockResolvedValue({
        id: '1',
        characterId: 'p1',
        espionageLevel: 5,
        canInfiltrate: false,
      } as CharacterEspionage);

      await expect(
        service.eavesdropIntelligence('p1', 'c2'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INTEL_LEVEL_NOT_ENOUGH },
      });
    });

    it('produces B-grade SECRET intel when level >= 5 and canInfiltrate', async () => {
      const record = {
        id: '1',
        characterId: 'p1',
        espionageLevel: 5,
        canInfiltrate: true,
        intelligenceValue: 100,
        counterSpyLevel: 0,
      } as CharacterEspionage;
      espionageRepo.findOne.mockResolvedValue(record);

      const result = await service.eavesdropIntelligence('p1', 'c2');

      expect(result.grade).toBe(IntelligenceGrade.B);
      expect(result.intelType).toBe(IntelType.SECRET);
      expect(result.freshnessExpireAt).toBeInstanceOf(Date);
      expect(record.intelligenceValue).toBe(120);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.INTEL_GAINED,
        expect.any(Object),
      );
    });
  });

  // ===== Intelligence: query =====

  describe('getIntelligences', () => {
    it('marks expired B-grade intel as EXPIRED on read', async () => {
      const expired = {
        id: '1',
        ownerId: 'p1',
        grade: IntelligenceGrade.B,
        freshnessExpireAt: new Date(Date.now() - 60_000),
        status: IntelStatus.ACTIVE,
      } as Intelligence;
      intelligenceRepo.find.mockResolvedValue([expired]);
      intelligenceRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.getIntelligences('p1');

      expect(result[0].status).toBe(IntelStatus.EXPIRED);
      expect(intelligenceRepo.save).toHaveBeenCalled();
    });

    it('keeps C-grade intel untouched (no freshness check)', async () => {
      const c = {
        id: '2',
        ownerId: 'p1',
        grade: IntelligenceGrade.C,
        freshnessExpireAt: null,
        status: IntelStatus.ACTIVE,
      } as Intelligence;
      intelligenceRepo.find.mockResolvedValue([c]);
      intelligenceRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.getIntelligences('p1');

      expect(result[0].status).toBe(IntelStatus.ACTIVE);
      expect(intelligenceRepo.save).not.toHaveBeenCalled();
    });
  });

  // ===== Intelligence: market =====

  describe('listIntelligence', () => {
    it('throws INTEL_NOT_FOUND when not owner', async () => {
      intelligenceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.listIntelligence('p1', '1', 100),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INTEL_NOT_FOUND },
      });
    });

    it('throws INTEL_ALREADY_LISTED when already listed', async () => {
      intelligenceRepo.findOne.mockResolvedValue({
        id: '1',
        ownerId: 'p1',
        status: IntelStatus.LISTED,
        isListed: true,
      } as Intelligence);

      await expect(
        service.listIntelligence('p1', '1', 100),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INTEL_ALREADY_LISTED },
      });
    });

    it('throws INTEL_EXPIRED when not active', async () => {
      intelligenceRepo.findOne.mockResolvedValue({
        id: '1',
        ownerId: 'p1',
        status: IntelStatus.EXPIRED,
        isListed: false,
      } as Intelligence);

      await expect(
        service.listIntelligence('p1', '1', 100),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INTEL_EXPIRED },
      });
    });

    it('lists an active intel', async () => {
      const intel = {
        id: '1',
        ownerId: 'p1',
        status: IntelStatus.ACTIVE,
        isListed: false,
      } as Intelligence;
      intelligenceRepo.findOne.mockResolvedValue(intel);
      intelligenceRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.listIntelligence('p1', '1', 500);

      expect(result.isListed).toBe(true);
      expect(result.status).toBe(IntelStatus.LISTED);
      expect(result.price).toBe('500');
    });
  });

  describe('getIntelMarket', () => {
    it('returns paginated listed intel', async () => {
      intelligenceRepo.findAndCount.mockResolvedValue([
        [{ id: '1' } as Intelligence],
        1,
      ]);

      const result = await service.getIntelMarket(1, 10);

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(intelligenceRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isListed: true } }),
      );
    });
  });

  describe('buyIntelligence', () => {
    it('transfers intel, settles currency and emits INTEL_SOLD', async () => {
      const listed = {
        id: '1',
        ownerId: 'seller',
        status: IntelStatus.LISTED,
        isListed: true,
        price: '500',
        sellerTrace: null,
      } as Intelligence;
      intelligenceRepo.findOne.mockResolvedValue(listed);
      economyService.deductCurrency.mockResolvedValue({ balanceAfter: '0' });
      economyService.addCurrency.mockResolvedValue({ balanceAfter: '500' });
      intelligenceRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.buyIntelligence('buyer', '1');

      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'buyer',
        CurrencyType.GOLD,
        500,
        'intel_buy',
        'intel_market',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'seller',
        CurrencyType.GOLD,
        500,
        'intel_sale',
        'intel_market',
      );
      expect(result.ownerId).toBe('buyer');
      expect(result.status).toBe(IntelStatus.ACTIVE);
      expect(result.isListed).toBe(false);
      expect(result.price).toBeNull();
      expect(result.sellerTrace).toMatchObject({
        sellerId: 'seller',
        price: 500,
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.INTEL_SOLD,
        expect.any(Object),
      );
    });

    it('rejects buying own intel', async () => {
      intelligenceRepo.findOne.mockResolvedValue({
        id: '1',
        ownerId: 'buyer',
        status: IntelStatus.LISTED,
        isListed: true,
        price: '100',
      } as Intelligence);

      await expect(service.buyIntelligence('buyer', '1')).rejects.toMatchObject(
        {
          response: {
            code: ErrorCodes.INTEL_NOT_FOUND,
            msg: '不能购买自己的情报',
          },
        },
      );
      expect(economyService.deductCurrency).not.toHaveBeenCalled();
    });

    it('rejects when intel is not listed', async () => {
      intelligenceRepo.findOne.mockResolvedValue({
        id: '1',
        ownerId: 'seller',
        status: IntelStatus.ACTIVE,
        isListed: false,
        price: null,
      } as Intelligence);

      await expect(service.buyIntelligence('buyer', '1')).rejects.toMatchObject(
        {
          response: {
            code: ErrorCodes.INTEL_NOT_FOUND,
            msg: '情报不可购买',
          },
        },
      );
    });
  });

  describe('consumeIntelligence', () => {
    it('consumes owned intel', async () => {
      const intel = {
        id: '1',
        ownerId: 'p1',
        status: IntelStatus.ACTIVE,
      } as Intelligence;
      intelligenceRepo.findOne.mockResolvedValue(intel);
      intelligenceRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.consumeIntelligence('p1', '1');

      expect(result.status).toBe(IntelStatus.CONSUMED);
      expect(intelligenceRepo.save).toHaveBeenCalledWith(intel);
    });

    it('throws INTEL_NOT_FOUND when not owner', async () => {
      intelligenceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.consumeIntelligence('p1', '1'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.INTEL_NOT_FOUND },
      });
    });
  });

  describe('sendGift', () => {
    beforeEach(() => {
      friendRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        friendId: 't1',
        status: FriendStatus.ACCEPTED,
      } as any);
      giftRepo.findOne.mockResolvedValue({
        id: '1',
        itemId: 'g1',
        giftWeight: 10,
        dailyCap: 5,
      } as any);
      cacheService.get.mockResolvedValue(null);
      inventoryService.removeItem.mockResolvedValue({} as any);
      characterService.increaseFavorability.mockResolvedValue({
        id: '1',
        characterId: 'p1',
        targetId: 't1',
        favorability: 60,
        level: RelationshipLevel.ACQUAINTANCE,
      } as any);
    });

    it('delivers gift, bumps favorability and opens reciprocate window', async () => {
      const result = await service.sendGift('p1', 't1', 'g1');
      expect(result).toMatchObject({
        giftWeight: 10,
        favorability: 60,
        level: RelationshipLevel.ACQUAINTANCE,
      });
      expect(inventoryService.removeItem).toHaveBeenCalledWith(
        'p1',
        'g1',
        1,
        'gift_send',
      );
      expect(characterService.increaseFavorability).toHaveBeenCalledWith(
        'p1',
        't1',
        10,
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        'gift:send:p1',
        '1',
        86400,
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        'gift:reciprocate:t1:p1',
        '1',
        86400,
      );
    });

    it('throws NOT_FRIEND when target is not an accepted friend', async () => {
      friendRepo.findOne.mockResolvedValue(null);
      await expect(service.sendGift('p1', 't1', 'g1')).rejects.toMatchObject({
        response: { code: ErrorCodes.NOT_FRIEND },
      });
      expect(characterService.increaseFavorability).not.toHaveBeenCalled();
    });

    it('throws GIFT_NOT_FOUND without template', async () => {
      giftRepo.findOne.mockResolvedValue(null);
      await expect(service.sendGift('p1', 't1', 'g1')).rejects.toMatchObject({
        response: { code: ErrorCodes.GIFT_NOT_FOUND },
      });
    });

    it('throws GIFT_DAILY_CAP when daily count reached', async () => {
      cacheService.get.mockResolvedValue('5');
      await expect(service.sendGift('p1', 't1', 'g1')).rejects.toMatchObject({
        response: { code: ErrorCodes.GIFT_DAILY_CAP },
      });
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
    });
  });

  describe('reciprocateGift', () => {
    beforeEach(() => {
      giftRepo.findOne.mockResolvedValue({
        id: '1',
        itemId: 'g1',
        giftWeight: 10,
        dailyCap: 5,
      } as any);
      cacheService.get.mockResolvedValue(null);
      cacheService.get.mockImplementation(async (key: string) =>
        key === 'gift:reciprocate:t1:p1' ? '1' : null,
      );
      inventoryService.removeItem.mockResolvedValue({} as any);
      characterService.increaseFavorability.mockResolvedValue({
        id: '1',
        favorability: 30,
        level: RelationshipLevel.STRANGER,
      } as any);
    });

    it('delivers gift and clears the reciprocate window', async () => {
      const result = await service.reciprocateGift('t1', 'p1', 'g1');
      expect(result).toMatchObject({ giftWeight: 10, favorability: 30 });
      expect(cacheService.del).toHaveBeenCalledWith('gift:reciprocate:t1:p1');
      expect(characterService.increaseFavorability).toHaveBeenCalledWith(
        't1',
        'p1',
        10,
      );
    });

    it('throws GIFT_RECIPROCATE_EXPIRED without window', async () => {
      cacheService.get.mockResolvedValue(null);
      await expect(
        service.reciprocateGift('t1', 'p1', 'g1'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GIFT_RECIPROCATE_EXPIRED },
      });
      expect(inventoryService.removeItem).not.toHaveBeenCalled();
    });
  });

  describe('formKinship', () => {
    beforeEach(() => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.CONFIDANT,
      );
      kinshipRepo.findOne.mockResolvedValue(null);
      playerService.getById.mockResolvedValue({ level: 50 } as any);
    });

    it('rejects sworn with 2 members', async () => {
      await expect(
        service.formKinship('p1', KinshipType.SWORN, ['p2']),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.KINSHIP_SIZE_INVALID },
      });
    });

    it('creates sworn kinship with 3 members', async () => {
      const result = await service.formKinship(
        'p1',
        KinshipType.SWORN,
        ['p2', 'p3'],
        '桃园三义',
      );
      expect(result).toMatchObject({
        type: KinshipType.SWORN,
        leaderId: 'p1',
        name: '桃园三义',
        status: KinshipStatus.ACTIVE,
      });
      expect(result.members).toEqual(['p1', 'p2', 'p3']);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.KINSHIP_FORMED,
        expect.objectContaining({ type: KinshipType.SWORN }),
      );
    });

    it('rejects sworn with 9 members', async () => {
      await expect(
        service.formKinship('p1', KinshipType.SWORN, [
          'p2',
          'p3',
          'p4',
          'p5',
          'p6',
          'p7',
          'p8',
          'p9',
        ]),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.KINSHIP_SIZE_INVALID },
      });
    });

    it('throws RELATIONSHIP_NOT_ENOUGH when favorability below confidant', async () => {
      characterService.getRelationshipLevel.mockResolvedValue(
        RelationshipLevel.FRIEND,
      );
      await expect(
        service.formKinship('p1', KinshipType.COUPLE, ['p2']),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.RELATIONSHIP_NOT_ENOUGH },
      });
    });

    it('throws KINSHIP_LEVEL_GAP for master with insufficient level gap', async () => {
      playerService.getById.mockImplementation(async (id: string) =>
        id === 'p1' ? { level: 20 } : { level: 15 },
      );
      await expect(
        service.formKinship('p1', KinshipType.MASTER, ['p2']),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.KINSHIP_LEVEL_GAP },
      });
    });

    it('creates master kinship when level gap >= 10', async () => {
      playerService.getById.mockImplementation(async (id: string) =>
        id === 'p1' ? { level: 50 } : { level: 30 },
      );
      const result = await service.formKinship(
        'p1',
        KinshipType.MASTER,
        ['p2'],
        '师门',
      );
      expect(result).toMatchObject({
        type: KinshipType.MASTER,
        leaderId: 'p1',
      });
      expect(result.members).toEqual(['p1', 'p2']);
    });

    it('throws KINSHIP_EXISTS when participant has active kinship', async () => {
      kinshipRepo.findOne.mockResolvedValue({
        id: 'k1',
        type: KinshipType.COUPLE,
        leaderId: 'p9',
        members: ['p9', 'p2'],
        status: KinshipStatus.ACTIVE,
      } as any);
      await expect(
        service.formKinship('p1', KinshipType.COUPLE, ['p2']),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.KINSHIP_EXISTS },
      });
    });
  });

  describe('breakKinship', () => {
    it('disbands kinship by member and emits event', async () => {
      kinshipRepo.findOne.mockResolvedValue({
        id: 'k1',
        type: KinshipType.COUPLE,
        leaderId: 'p1',
        members: ['p1', 'p2'],
        status: KinshipStatus.ACTIVE,
      } as any);
      const result = await service.breakKinship('p2', 'k1');
      expect(result.status).toBe(KinshipStatus.DISBANDED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.KINSHIP_BROKEN,
        expect.objectContaining({ kinshipId: 'k1', playerId: 'p2' }),
      );
    });

    it('throws KINSHIP_NOT_OWNER for outsider', async () => {
      kinshipRepo.findOne.mockResolvedValue({
        id: 'k1',
        type: KinshipType.COUPLE,
        leaderId: 'p1',
        members: ['p1', 'p2'],
        status: KinshipStatus.ACTIVE,
      } as any);
      await expect(service.breakKinship('p9', 'k1')).rejects.toMatchObject({
        response: { code: ErrorCodes.KINSHIP_NOT_OWNER },
      });
    });
  });

  describe('graduateApprentice', () => {
    it('graduates apprentice when level reached', async () => {
      kinshipRepo.findOne.mockResolvedValue({
        id: 'k1',
        type: KinshipType.MASTER,
        leaderId: 'p1',
        members: ['p1', 'p2'],
        status: KinshipStatus.ACTIVE,
      } as any);
      playerService.getById.mockImplementation(async (id: string) =>
        id === 'p1' ? { level: 50 } : { level: 50 },
      );
      const result = await service.graduateApprentice('p1', 'k1');
      expect(result.status).toBe(KinshipStatus.DISBANDED);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.KINSHIP_BROKEN,
        expect.objectContaining({ reason: 'graduate' }),
      );
    });

    it('throws KINSHIP_LEVEL_GAP when apprentice below master level', async () => {
      kinshipRepo.findOne.mockResolvedValue({
        id: 'k1',
        type: KinshipType.MASTER,
        leaderId: 'p1',
        members: ['p1', 'p2'],
        status: KinshipStatus.ACTIVE,
      } as any);
      playerService.getById.mockImplementation(async (id: string) =>
        id === 'p1' ? { level: 50 } : { level: 49 },
      );
      await expect(
        service.graduateApprentice('p1', 'k1'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.KINSHIP_LEVEL_GAP },
      });
    });

    it('throws KINSHIP_NOT_OWNER when not the master', async () => {
      kinshipRepo.findOne.mockResolvedValue({
        id: 'k1',
        type: KinshipType.MASTER,
        leaderId: 'p1',
        members: ['p1', 'p2'],
        status: KinshipStatus.ACTIVE,
      } as any);
      await expect(
        service.graduateApprentice('p2', 'k1'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.KINSHIP_NOT_OWNER },
      });
    });
  });

  describe('getSocialSummary', () => {
    it('combines friends, kinships and relationships', async () => {
      friendRepo.find.mockResolvedValue([{ id: 'f1' }] as any);
      kinshipRepo.find.mockResolvedValue([{ id: 'k1' }] as any);
      characterService.getRelationships.mockResolvedValue([{ id: 'r1' }] as any);
      const result = await service.getSocialSummary('p1');
      expect(result).toEqual({
        friends: [{ id: 'f1' }],
        kinships: [{ id: 'k1' }],
        relationships: [{ id: 'r1' }],
      });
    });
  });

  describe('getDailyGuide', () => {
    it('returns D1 guide for new player with kinship task undone', async () => {
      playerService.getById.mockResolvedValue({
        createdAt: new Date(Date.now() - 2 * 3600 * 1000),
      } as any);
      friendRepo.find.mockResolvedValue([]);
      kinshipRepo.find.mockResolvedValue([]);
      intelligenceRepo.find.mockResolvedValue([]);
      guildMemberRepo.findOne.mockResolvedValue(null);

      const result = await service.getDailyGuide('p1');

      expect(result.day).toBe(1);
      expect(result.title).toBe('寻师问路');
      expect(result.tasks[0].done).toBe(false);
      expect(result.stats).toEqual({ friends: 0, kinships: 0, intel: 0, inGuild: false });
    });

    it('marks D4 guild task done when member of a guild', async () => {
      playerService.getById.mockResolvedValue({
        createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      } as any);
      friendRepo.find.mockResolvedValue([]);
      kinshipRepo.find.mockResolvedValue([]);
      intelligenceRepo.find.mockResolvedValue([]);
      guildMemberRepo.findOne.mockResolvedValue({ id: 'm1' } as any);

      const result = await service.getDailyGuide('p1');

      expect(result.day).toBe(4);
      expect(result.tasks[0].done).toBe(true);
      expect(result.stats.inGuild).toBe(true);
    });

    it('caps at day 8 daily loop for old players', async () => {
      playerService.getById.mockResolvedValue({
        createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      } as any);
      friendRepo.find.mockResolvedValue([]);
      kinshipRepo.find.mockResolvedValue([]);
      intelligenceRepo.find.mockResolvedValue([]);
      guildMemberRepo.findOne.mockResolvedValue(null);

      const result = await service.getDailyGuide('p1');

      expect(result.day).toBe(8);
      expect(result.title).toBe('日常循环');
    });
  });

  describe('setGuildRole', () => {
    const member = (role: GuildRole, playerId = 'p1') =>
      ({ id: '1', guildId: '1', playerId, role, contribution: 0 } as GuildMember);

    it('throws GUILD_ROLE_FORBIDDEN when operator is a plain member', async () => {
      guildMemberRepo.findOne.mockResolvedValue(member(GuildRole.MEMBER));
      await expect(
        service.setGuildRole('p1', '1', 'p2', GuildRole.HALL_MASTER),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_ROLE_FORBIDDEN },
      });
    });

    it('throws GUILD_ROLE_FORBIDDEN when directly appointing leader', async () => {
      guildMemberRepo.findOne.mockResolvedValue(member(GuildRole.LEADER));
      await expect(
        service.setGuildRole('p1', '1', 'p2', GuildRole.LEADER),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_ROLE_FORBIDDEN },
      });
    });

    it('appoints hall master as leader and appends log + event', async () => {
      guildMemberRepo.findOne
        .mockResolvedValueOnce(member(GuildRole.LEADER))
        .mockResolvedValueOnce(member(GuildRole.MEMBER, 'p2'));
      const guild = { id: '1', actionLog: [] } as any;
      guildRepo.findOneOrFail = jest.fn().mockResolvedValue(guild);
      guildRepo.save = jest.fn().mockImplementation((g: any) => Promise.resolve(g));

      const result = await service.setGuildRole(
        'p1',
        '1',
        'p2',
        GuildRole.HALL_MASTER,
      );

      expect(result.role).toBe(GuildRole.HALL_MASTER);
      expect(guildRepo.save).toHaveBeenCalled();
      expect(guild.actionLog).toHaveLength(1);
      expect(guild.actionLog[0].type).toBe('role_change');
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GUILD_ROLE_CHANGED,
        expect.any(Object),
      );
    });
  });

  describe('initiateImpeachment', () => {
    it('throws GUILD_ROLE_FORBIDDEN below vice leader', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.HALL_MASTER,
      } as GuildMember);
      await expect(service.initiateImpeachment('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_ROLE_FORBIDDEN },
      });
    });

    it('throws GUILD_IMPEACHMENT_NOT_READY when leader active within 7 days', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.VICE_LEADER,
      } as GuildMember);
      guildRepo.findOne.mockResolvedValue({
        id: '1', leaderId: 'l1', actionLog: [],
      } as any);
      playerService.getById.mockResolvedValue({
        lastActivityAt: new Date(Date.now() - 3600 * 1000),
      } as any);
      await expect(service.initiateImpeachment('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_IMPEACHMENT_NOT_READY },
      });
    });

    it('throws GUILD_IMPEACHMENT_EXISTS when pending impeachment present', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.VICE_LEADER,
      } as GuildMember);
      guildRepo.findOne.mockResolvedValue({
        id: '1', leaderId: 'l1', actionLog: [],
      } as any);
      playerService.getById.mockResolvedValue({
        lastActivityAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
      } as any);
      impeachmentRepo.findOne.mockResolvedValue({ id: 'i1' } as any);
      await expect(service.initiateImpeachment('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_IMPEACHMENT_EXISTS },
      });
    });

    it('creates pending impeachment when leader inactive', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.VICE_LEADER,
      } as GuildMember);
      guildRepo.findOne.mockResolvedValue({
        id: '1', leaderId: 'l1', actionLog: [],
      } as any);
      playerService.getById.mockResolvedValue({
        lastActivityAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
      } as any);
      impeachmentRepo.findOne.mockResolvedValue(null);
      impeachmentRepo.save.mockResolvedValue({
        id: 'i1', guildId: '1', targetId: 'l1', initiatorId: 'p1',
        endorsements: [], status: GuildImpeachmentStatus.PENDING,
      } as any);

      const result = await service.initiateImpeachment('p1', '1');
      expect(result.status).toBe(GuildImpeachmentStatus.PENDING);
      expect(result.targetId).toBe('l1');
      expect(impeachmentRepo.create).toHaveBeenCalled();
    });
  });

  describe('endorseImpeachment', () => {
    it('throws GUILD_ROLE_FORBIDDEN below hall master', async () => {
      impeachmentRepo.findOne.mockResolvedValue({
        id: 'i1', guildId: '1', status: GuildImpeachmentStatus.PENDING,
        endorsements: [],
      } as any);
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.MEMBER,
      } as GuildMember);
      await expect(
        service.endorseImpeachment('p1', 'i1'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_ROLE_FORBIDDEN },
      });
    });

    it('transfers leadership to top-contribution vice leader when quorum reached', async () => {
      impeachmentRepo.findOne.mockResolvedValue({
        id: 'i1', guildId: '1', status: GuildImpeachmentStatus.PENDING,
        endorsements: [],
      } as any);
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.HALL_MASTER,
      } as GuildMember);
      guildMemberRepo.find.mockResolvedValue([
        { id: '1', guildId: '1', playerId: 'h1', role: GuildRole.HALL_MASTER, contribution: 10 },
        { id: '3', guildId: '1', playerId: 'v2', role: GuildRole.VICE_LEADER, contribution: 40 },
      ] as any);
      const guild = { id: '1', leaderId: 'l1', actionLog: [] } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      guildRepo.save = jest.fn().mockImplementation((g: any) => Promise.resolve(g));
      impeachmentRepo.save.mockImplementation((d: any) => Promise.resolve(d));

      const result = await service.endorseImpeachment('p1', 'i1');

      expect(result.status).toBe(GuildImpeachmentStatus.DONE);
      expect(result.endedAt).toBeInstanceOf(Date);
      expect(guild.leaderId).toBe('v2');
      expect(guild.actionLog[0].type).toBe('impeach');
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GUILD_IMPEACHMENT,
        expect.objectContaining({ newLeaderId: 'v2' }),
      );
    });
  });

  describe('getGuildLog', () => {
    it('returns action log entries', async () => {
      const log = [{ type: 'role_change', playerId: 'p1', detail: 'x', at: 't' }];
      guildRepo.findOne.mockResolvedValue({ id: '1', actionLog: log } as any);
      const result = await service.getGuildLog('1');
      expect(result).toEqual(log);
    });

    it('returns empty array when guild missing', async () => {
      guildRepo.findOne.mockResolvedValue(null);
      const result = await service.getGuildLog('1');
      expect(result).toEqual([]);
    });
  });

  describe('buildBuilding', () => {
    const leader = { id: '1', guildId: '1', playerId: 'p1', role: GuildRole.LEADER } as GuildMember;
    const member = { id: '1', guildId: '1', playerId: 'p1', role: GuildRole.MEMBER } as GuildMember;

    it('throws GUILD_ROLE_FORBIDDEN for plain member', async () => {
      guildMemberRepo.findOne.mockResolvedValue(member);
      await expect(
        service.buildBuilding('p1', '1', GuildBuildingType.MEETING_HALL),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_ROLE_FORBIDDEN },
      });
    });

    it('creates Lv1 building and deducts 10000 fund', async () => {
      guildMemberRepo.findOne.mockResolvedValue(leader);
      buildingRepo.findOne.mockResolvedValue(null);
      const guild = { id: '1', fund: '50000' } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      guildRepo.save = jest.fn().mockImplementation((g: any) => Promise.resolve(g));
      fundLogRepo.save.mockImplementation((d: any) => Promise.resolve(d));
      buildingRepo.save.mockResolvedValue({
        id: '1', guildId: '1', buildingType: GuildBuildingType.MEETING_HALL, level: 1,
      } as any);

      const result = await service.buildBuilding(
        'p1', '1', GuildBuildingType.MEETING_HALL,
      );

      expect(result.level).toBe(1);
      expect(guild.fund).toBe('40000');
      expect(fundLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '10000', type: GuildFundType.EXPENSE }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GUILD_FUND_CHANGED, expect.any(Object),
      );
    });

    it('upgrades existing building Lv1→Lv2 deducting 20000', async () => {
      guildMemberRepo.findOne.mockResolvedValue(leader);
      buildingRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', buildingType: GuildBuildingType.BLACKSMITH, level: 1,
      } as any);
      const guild = { id: '1', fund: '50000' } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      guildRepo.save = jest.fn().mockImplementation((g: any) => Promise.resolve(g));
      fundLogRepo.save.mockImplementation((d: any) => Promise.resolve(d));
      buildingRepo.save.mockResolvedValue({
        id: '1', guildId: '1', buildingType: GuildBuildingType.BLACKSMITH, level: 2,
      } as any);

      const result = await service.buildBuilding(
        'p1', '1', GuildBuildingType.BLACKSMITH,
      );

      expect(result.level).toBe(2);
      expect(guild.fund).toBe('30000');
    });

    it('throws GUILD_BUILDING_LEVEL_CAP at Lv5', async () => {
      guildMemberRepo.findOne.mockResolvedValue(leader);
      buildingRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', buildingType: GuildBuildingType.BLACKSMITH, level: 5,
      } as any);
      await expect(
        service.buildBuilding('p1', '1', GuildBuildingType.BLACKSMITH),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_BUILDING_LEVEL_CAP },
      });
    });

    it('throws GUILD_FUND_NOT_ENOUGH when fund insufficient', async () => {
      guildMemberRepo.findOne.mockResolvedValue(leader);
      buildingRepo.findOne.mockResolvedValue(null);
      const guild = { id: '1', fund: '5000' } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      await expect(
        service.buildBuilding('p1', '1', GuildBuildingType.HERB_GARDEN),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_FUND_NOT_ENOUGH },
      });
      expect(guild.fund).toBe('5000');
    });
  });

  describe('adjustGuildFund', () => {
    it('records income and emits GUILD_FUND_CHANGED', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.VICE_LEADER,
      } as GuildMember);
      const guild = { id: '1', fund: '10000' } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      guildRepo.save = jest.fn().mockImplementation((g: any) => Promise.resolve(g));
      fundLogRepo.save.mockImplementation((d: any) => Promise.resolve(d));

      const result = await service.adjustGuildFund('p1', '1', 5000, '拍卖分成');

      expect(guild.fund).toBe('15000');
      expect(result.type).toBe(GuildFundType.INCOME);
      expect(fundLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '5000', reason: '拍卖分成' }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GUILD_FUND_CHANGED,
        expect.objectContaining({ amount: 5000, balance: '15000' }),
      );
    });

    it('throws GUILD_FUND_NOT_ENOUGH when expense exceeds balance', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.LEADER,
      } as GuildMember);
      const guild = { id: '1', fund: '1000' } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      await expect(
        service.adjustGuildFund('p1', '1', -5000, '支出'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_FUND_NOT_ENOUGH },
      });
      expect(guildRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getGuildFundLogs', () => {
    it('returns paginated fund logs', async () => {
      fundLogRepo.findAndCount.mockResolvedValue([[{ id: '1' }] as any, 1]);
      const result = await service.getGuildFundLogs('1', 1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('donateToGuild fund & contrib linkage', () => {
    it('adds gold to guild fund and issues GUILD_CONTRIB currency', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.MEMBER, contribution: 0,
      } as GuildMember);
      const guild = { id: '1', fund: '0' } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      guildRepo.save = jest.fn().mockImplementation((g: any) => Promise.resolve(g));
      economyService.addCurrency.mockResolvedValue({ balanceAfter: '10' });

      const result = await service.donateToGuild('p1', '1', DonateType.GOLD, '1000');

      expect(result.contributionGained).toBe(10);
      expect(guild.fund).toBe('1000');
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        CurrencyType.GUILD_CONTRIB,
        10,
        'guild_donate',
        'social.donateToGuild',
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GUILD_CONTRIB_GAINED,
        expect.objectContaining({ amount: 10 }),
      );
    });
  });

  describe('createGuildActivity', () => {
    it('creates scheduled activity as leader', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.LEADER,
      } as GuildMember);
      activityRepo.save.mockImplementation((d: any) => Promise.resolve(d));

      const result = await service.createGuildActivity(
        'p1', '1', GuildActivityType.BANQUET, new Date('2026-10-01T10:00:00Z'),
      );

      expect(result.status).toBe(GuildActivityStatus.SCHEDULED);
      expect(result.activityType).toBe(GuildActivityType.BANQUET);
      expect(activityRepo.create).toHaveBeenCalled();
    });

    it('throws GUILD_ROLE_FORBIDDEN for member', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.MEMBER,
      } as GuildMember);
      await expect(
        service.createGuildActivity('p1', '1', GuildActivityType.QUIZ, new Date()),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_ROLE_FORBIDDEN },
      });
    });
  });

  describe('getGuildActivities', () => {
    it('returns activities ordered by schedule', async () => {
      activityRepo.find.mockResolvedValue([{ id: 'a1' }] as any);
      const result = await service.getGuildActivities('1');
      expect(result).toHaveLength(1);
      expect(activityRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { guildId: '1' } }),
      );
    });
  });

  describe('setDiplomacy', () => {
    it('creates friendly diplomacy and emits event', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.LEADER,
      } as GuildMember);
      guildRepo.findOne
        .mockResolvedValueOnce({ id: '1' } as any)
        .mockResolvedValueOnce({ id: '2' } as any);
      diplomacyRepo.findOne.mockResolvedValue(null);
      diplomacyRepo.save.mockImplementation((d: any) => Promise.resolve(d));

      const result = await service.setDiplomacy(
        'p1', '1', '2', GuildDiplomacyRelation.FRIENDLY,
      );

      expect(result.relation).toBe(GuildDiplomacyRelation.FRIENDLY);
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GUILD_DIPLOMACY_CHANGED,
        expect.objectContaining({ guildId: '1', targetGuildId: '2' }),
      );
    });

    it('updates existing diplomacy relation', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.LEADER,
      } as GuildMember);
      guildRepo.findOne
        .mockResolvedValueOnce({ id: '1' } as any)
        .mockResolvedValueOnce({ id: '2' } as any);
      diplomacyRepo.findOne.mockResolvedValue({
        id: 'd1', guildId: '1', targetGuildId: '2', relation: GuildDiplomacyRelation.NEUTRAL,
      } as any);
      diplomacyRepo.save.mockImplementation((d: any) => Promise.resolve(d));

      const result = await service.setDiplomacy(
        'p1', '1', '2', GuildDiplomacyRelation.HOSTILE,
      );

      expect(result.relation).toBe(GuildDiplomacyRelation.HOSTILE);
      expect(diplomacyRepo.create).not.toHaveBeenCalled();
    });

    it('throws GUILD_DIPLOMACY_EXISTS when targeting self', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.LEADER,
      } as GuildMember);
      guildRepo.findOne
        .mockResolvedValueOnce({ id: '1' } as any)
        .mockResolvedValueOnce({ id: '1' } as any);
      await expect(
        service.setDiplomacy('p1', '1', '1', GuildDiplomacyRelation.FRIENDLY),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_DIPLOMACY_EXISTS },
      });
    });
  });

  describe('getGuildDiplomacies', () => {
    it('returns diplomacy list', async () => {
      diplomacyRepo.find.mockResolvedValue([{ id: 'd1' }] as any);
      const result = await service.getGuildDiplomacies('1');
      expect(result).toHaveLength(1);
    });
  });

  describe('exchangeGuildShop', () => {
    it('deducts GUILD_CONTRIB and returns cost', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'p1', role: GuildRole.MEMBER,
      } as GuildMember);
      economyService.deductCurrency.mockResolvedValue({ balanceAfter: '50' });

      const result = await service.exchangeGuildShop(
        'p1', '1', GuildShopRewardType.SKILL_POINT,
      );

      expect(result.cost).toBe(100);
      expect(economyService.deductCurrency).toHaveBeenCalledWith(
        'p1', CurrencyType.GUILD_CONTRIB, 100, 'guild_shop', 'social.exchangeGuildShop',
      );
      expect(result.balanceAfter).toBe('50');
    });

    it('throws GUILD_PERMISSION_DENIED when not a member', async () => {
      guildMemberRepo.findOne.mockResolvedValue(null);
      await expect(
        service.exchangeGuildShop('p1', '1', GuildShopRewardType.TITLE),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_PERMISSION_DENIED },
      });
    });
  });

  describe('paySalaries', () => {
    it('pays only active members by role and deducts guild fund', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'op', role: GuildRole.LEADER,
      } as GuildMember);
      const guild = { id: '1', fund: '100000' } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      guildRepo.save = jest.fn().mockImplementation((g: any) => Promise.resolve(g));
      guildMemberRepo.find.mockResolvedValue([
        { id: '1', guildId: '1', playerId: 'op', role: GuildRole.LEADER },
        { id: '2', guildId: '1', playerId: 'v1', role: GuildRole.VICE_LEADER },
        { id: '3', guildId: '1', playerId: 'inactive', role: GuildRole.HALL_MASTER },
      ] as any);
      playerService.getById.mockImplementation(async (id: string) =>
        id === 'inactive'
          ? { lastActivityAt: new Date(Date.now() - 10 * 24 * 3600 * 1000) }
          : { lastActivityAt: new Date(Date.now() - 3600 * 1000) },
      );
      economyService.addCurrency.mockResolvedValue({ balanceAfter: '0' });
      fundLogRepo.save.mockImplementation((d: any) => Promise.resolve(d));

      const result = await service.paySalaries('op', '1');

      expect(result.total).toBe(8000); // leader 5000 + vice 3000
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'op', CurrencyType.GOLD, 5000, 'guild_salary', 'social.paySalaries',
      );
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'v1', CurrencyType.GOLD, 3000, 'guild_salary', 'social.paySalaries',
      );
      expect(economyService.addCurrency).not.toHaveBeenCalledWith(
        'inactive', expect.anything(), expect.anything(), 'guild_salary', 'social.paySalaries',
      );
      expect(guild.fund).toBe('92000');
      expect(fundLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '8000', type: GuildFundType.EXPENSE, reason: 'guild_salary' }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        GameEvents.GUILD_FUND_CHANGED,
        expect.objectContaining({ amount: -8000 }),
      );
    });

    it('throws GUILD_FUND_NOT_ENOUGH when fund below total salary', async () => {
      guildMemberRepo.findOne.mockResolvedValue({
        id: '1', guildId: '1', playerId: 'op', role: GuildRole.LEADER,
      } as GuildMember);
      const guild = { id: '1', fund: '1000' } as any;
      guildRepo.findOne.mockResolvedValue(guild);
      guildMemberRepo.find.mockResolvedValue([
        { id: '1', guildId: '1', playerId: 'op', role: GuildRole.LEADER },
      ] as any);
      playerService.getById.mockResolvedValue({
        lastActivityAt: new Date(Date.now() - 3600 * 1000),
      } as any);

      await expect(service.paySalaries('op', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.GUILD_FUND_NOT_ENOUGH },
      });
    });
  });

  describe('getGuildContributionRank', () => {
    it('returns members sorted by contribution desc', async () => {
      const members = [
        { id: '1', playerId: 'a', contribution: 100 },
        { id: '2', playerId: 'b', contribution: 50 },
      ] as any;
      guildMemberRepo.find.mockResolvedValue(members);
      const result = await service.getGuildContributionRank('1');
      expect(result).toHaveLength(2);
      expect(guildMemberRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { contribution: 'DESC' } }),
      );
    });
  });
});
