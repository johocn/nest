import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SocialService } from './social.service';
import { Friend, Guild, GuildMember, GuildDonate } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { FriendStatus, GuildRole, DonateType } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('SocialService', () => {
  let service: SocialService;
  let friendRepo: jest.Mocked<Repository<Friend>>;
  let guildRepo: jest.Mocked<Repository<Guild>>;
  let guildMemberRepo: jest.Mocked<Repository<GuildMember>>;
  let guildDonateRepo: jest.Mocked<Repository<GuildDonate>>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
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
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(SocialService);
    friendRepo = module.get(getRepositoryToken(Friend));
    guildRepo = module.get(getRepositoryToken(Guild));
    guildMemberRepo = module.get(getRepositoryToken(GuildMember));
    guildDonateRepo = module.get(getRepositoryToken(GuildDonate));
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
});
