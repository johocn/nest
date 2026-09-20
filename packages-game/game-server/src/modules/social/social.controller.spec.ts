import { Test } from '@nestjs/testing';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { SocialEconomyService } from './social-economy.service';
import { SocialGuideService } from './social-guide.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { DonateType, ReportReason, ReportTargetType } from '@constants/enums';

const player = { playerId: 'p1' } as any;

describe('SocialController', () => {
  let controller: SocialController;
  const service = {
    applyFriend: jest.fn(),
    acceptFriend: jest.fn(),
    getFriendList: jest.fn(),
    removeFriend: jest.fn(),
    createGuild: jest.fn(),
    joinGuild: jest.fn(),
    getGuildInfo: jest.fn(),
    getGuildMembers: jest.fn(),
    donateToGuild: jest.fn(),
    spyIntelligence: jest.fn(),
    inquireIntelligence: jest.fn(),
    eavesdropIntelligence: jest.fn(),
    getIntelligences: jest.fn(),
    listIntelligence: jest.fn(),
    getIntelMarket: jest.fn(),
    buyIntelligence: jest.fn(),
    sendGift: jest.fn(),
    reciprocateGift: jest.fn(),
    formKinship: jest.fn(),
    breakKinship: jest.fn(),
    graduateApprentice: jest.fn(),
    getKinships: jest.fn(),
    getSocialSummary: jest.fn(),
    setGuildRole: jest.fn(),
    initiateImpeachment: jest.fn(),
    endorseImpeachment: jest.fn(),
    getImpeachment: jest.fn(),
    getGuildLog: jest.fn(),
    buildBuilding: jest.fn(),
    getGuildBuildings: jest.fn(),
    adjustGuildFund: jest.fn(),
    getGuildFundLogs: jest.fn(),
    createGuildActivity: jest.fn(),
    getGuildActivities: jest.fn(),
    setDiplomacy: jest.fn(),
    getGuildDiplomacies: jest.fn(),
    exchangeGuildShop: jest.fn(),
    paySalaries: jest.fn(),
    getGuildContributionRank: jest.fn(),
    submitReport: jest.fn(),
    blockPlayer: jest.fn(),
    unblockPlayer: jest.fn(),
    listBlocks: jest.fn(),
    recommendFriends: jest.fn(),
    getDailyGuideStats: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [
        { provide: SocialService, useValue: service },
        { provide: SocialEconomyService, useValue: { getPointInfo: jest.fn() } },
        {
          provide: SocialGuideService,
          useValue: {
            getDailyGuide: jest.fn(),
            claimTaskReward: jest.fn(),
          },
        },
      ],
    }).compile();
    controller = moduleRef.get<SocialController>(SocialController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should require JwtAuthGuard at class level', () => {
    const guards = Reflect.getMetadata('__guards__', SocialController);
    expect(guards).toEqual([JwtAuthGuard]);
  });

  describe('guide endpoints', () => {
    it('getDailyGuide merges guide progress with stats', async () => {
      (controller as any).guideService.getDailyGuide.mockResolvedValue({
        day: 2,
        title: '以武会友',
        tasks: [{ id: 'friend', desc: '添加 1 位好友', done: true, rewarded: false }],
        rewardReady: true,
      });
      service.getDailyGuideStats.mockResolvedValue({
        friends: 1,
        kinships: 0,
        intel: 0,
        inGuild: false,
      });
      const result = await controller.getDailyGuide(player);
      expect(result).toMatchObject({
        day: 2,
        title: '以武会友',
        rewardReady: true,
        stats: { friends: 1, inGuild: false },
      });
    });

    it('claimGuideReward delegates to guideService', async () => {
      (controller as any).guideService.claimTaskReward.mockResolvedValue({
        taskId: 'friend',
        points: 20,
        gold: 50,
      });
      const result = await controller.claimGuideReward(player, 'friend');
      expect(controller['guideService'].claimTaskReward).toHaveBeenCalledWith(
        'p1',
        'friend',
      );
      expect(result.points).toBe(20);
    });
  });

  describe('intel endpoints', () => {
    it('spyIntel passes playerId and targetId', async () => {
      service.spyIntelligence.mockResolvedValue({ id: 'i1' });
      const result = await controller.spyIntel(player, { targetId: 't1' });
      expect(service.spyIntelligence).toHaveBeenCalledWith('p1', 't1');
      expect(result).toEqual({ id: 'i1' });
    });

    it('inquireIntel passes playerId and topic', async () => {
      service.inquireIntelligence.mockResolvedValue({ id: 'i2' });
      const result = await controller.inquireIntel(player, { topic: '秘闻' });
      expect(service.inquireIntelligence).toHaveBeenCalledWith('p1', '秘闻');
      expect(result).toEqual({ id: 'i2' });
    });

    it('eavesdropIntel passes playerId and targetId', async () => {
      service.eavesdropIntelligence.mockResolvedValue({ id: 'i3' });
      const result = await controller.eavesdropIntel(player, { targetId: 't2' });
      expect(service.eavesdropIntelligence).toHaveBeenCalledWith('p1', 't2');
      expect(result).toEqual({ id: 'i3' });
    });

    it('myIntel passes playerId', async () => {
      service.getIntelligences.mockResolvedValue([{ id: 'i1' }]);
      const result = await controller.myIntel(player);
      expect(service.getIntelligences).toHaveBeenCalledWith('p1');
      expect(result).toEqual([{ id: 'i1' }]);
    });

    it('listIntel passes playerId, intelId and price', async () => {
      service.listIntelligence.mockResolvedValue({ id: 'i1', price: '500' });
      const result = await controller.listIntel(player, {
        intelId: 'i1',
        price: 500,
      });
      expect(service.listIntelligence).toHaveBeenCalledWith('p1', 'i1', 500);
      expect(result).toEqual({ id: 'i1', price: '500' });
    });

    it('intelMarket passes page and limit defaults', async () => {
      service.getIntelMarket.mockResolvedValue({ items: [], total: 0 });
      const result = await controller.intelMarket(1, 20);
      expect(service.getIntelMarket).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('buyIntel passes buyerId and intelId', async () => {
      service.buyIntelligence.mockResolvedValue({ id: 'i1' });
      const result = await controller.buyIntel(player, { intelId: 'i1' });
      expect(service.buyIntelligence).toHaveBeenCalledWith('p1', 'i1');
      expect(result).toEqual({ id: 'i1' });
    });
  });

  describe('friend/guild endpoints', () => {
    it('donate passes donateType and amount', async () => {
      service.donateToGuild.mockResolvedValue({ newTotal: 100 });
      const result = await controller.donate(player, {
        guildId: 'g1',
        donateType: 'gold',
        amount: '1000',
      });
      expect(service.donateToGuild).toHaveBeenCalledWith(
        'p1',
        'g1',
        DonateType.GOLD,
        '1000',
      );
      expect(result).toEqual({ newTotal: 100 });
    });
  });

  describe('gift/kinship endpoints', () => {
    it('sendGift passes playerId, targetId and itemId', async () => {
      service.sendGift.mockResolvedValue({ giftWeight: 10 });
      const result = await controller.sendGift(player, {
        targetId: 't1',
        itemId: 'g1',
      });
      expect(service.sendGift).toHaveBeenCalledWith('p1', 't1', 'g1');
      expect(result).toEqual({ giftWeight: 10 });
    });

    it('reciprocateGift passes playerId, targetId and itemId', async () => {
      service.reciprocateGift.mockResolvedValue({ giftWeight: 10 });
      const result = await controller.reciprocateGift(player, {
        targetId: 't1',
        itemId: 'g1',
      });
      expect(service.reciprocateGift).toHaveBeenCalledWith('p1', 't1', 'g1');
      expect(result).toEqual({ giftWeight: 10 });
    });

    it('formKinship passes type, memberIds and name', async () => {
      service.formKinship.mockResolvedValue({ id: 'k1' });
      const result = await controller.formKinship(player, {
        type: 'sworn',
        memberIds: ['p2', 'p3'],
        name: '桃园三义',
      } as any);
      expect(service.formKinship).toHaveBeenCalledWith(
        'p1',
        'sworn',
        ['p2', 'p3'],
        '桃园三义',
      );
      expect(result).toEqual({ id: 'k1' });
    });

    it('breakKinship passes kinshipId', async () => {
      service.breakKinship.mockResolvedValue({ id: 'k1', status: 'disbanded' });
      const result = await controller.breakKinship(player, { kinshipId: 'k1' });
      expect(service.breakKinship).toHaveBeenCalledWith('p1', 'k1');
      expect(result).toEqual({ id: 'k1', status: 'disbanded' });
    });

    it('graduateApprentice passes kinshipId', async () => {
      service.graduateApprentice.mockResolvedValue({ id: 'k1' });
      const result = await controller.graduateApprentice(player, {
        kinshipId: 'k1',
      });
      expect(service.graduateApprentice).toHaveBeenCalledWith('p1', 'k1');
      expect(result).toEqual({ id: 'k1' });
    });

    it('getKinships passes playerId', async () => {
      service.getKinships.mockResolvedValue([{ id: 'k1' }]);
      const result = await controller.getKinships(player);
      expect(service.getKinships).toHaveBeenCalledWith('p1');
      expect(result).toEqual([{ id: 'k1' }]);
    });

    it('getRelationships returns social summary', async () => {
      service.getSocialSummary.mockResolvedValue({
        friends: [],
        kinships: [],
        relationships: [],
      });
      const result = await controller.getRelationships(player);
      expect(service.getSocialSummary).toHaveBeenCalledWith('p1');
      expect(result).toEqual({
        friends: [],
        kinships: [],
        relationships: [],
      });
    });
  });

  describe('guild governance endpoints', () => {
    it('setGuildRole passes operator, guildId, playerId and role', async () => {
      service.setGuildRole.mockResolvedValue({ id: 'm1', role: 'hall_master' });
      const result = await controller.setGuildRole(player, {
        guildId: 'g1',
        playerId: 'p2',
        role: 'hall_master',
      } as any);
      expect(service.setGuildRole).toHaveBeenCalledWith('p1', 'g1', 'p2', 'hall_master');
      expect(result).toEqual({ id: 'm1', role: 'hall_master' });
    });

    it('impeach passes playerId and guildId', async () => {
      service.initiateImpeachment.mockResolvedValue({ id: 'i1' });
      const result = await controller.impeach(player, { guildId: 'g1' });
      expect(service.initiateImpeachment).toHaveBeenCalledWith('p1', 'g1');
      expect(result).toEqual({ id: 'i1' });
    });

    it('endorseImpeach passes playerId and impeachmentId', async () => {
      service.endorseImpeachment.mockResolvedValue({ id: 'i1', status: 'done' });
      const result = await controller.endorseImpeach(player, { impeachmentId: 'i1' });
      expect(service.endorseImpeachment).toHaveBeenCalledWith('p1', 'i1');
      expect(result).toEqual({ id: 'i1', status: 'done' });
    });

    it('getImpeachment passes guildId', async () => {
      service.getImpeachment.mockResolvedValue({ id: 'i1' });
      const result = await controller.getImpeachment('g1');
      expect(service.getImpeachment).toHaveBeenCalledWith('g1');
      expect(result).toEqual({ id: 'i1' });
    });

    it('getGuildLog passes guildId', async () => {
      service.getGuildLog.mockResolvedValue([]);
      const result = await controller.getGuildLog('g1');
      expect(service.getGuildLog).toHaveBeenCalledWith('g1');
      expect(result).toEqual([]);
    });
  });

  describe('guild base/fund endpoints', () => {
    it('buildBuilding passes playerId, guildId and buildingType', async () => {
      service.buildBuilding.mockResolvedValue({ id: 'b1', level: 1 });
      const result = await controller.buildBuilding(player, {
        guildId: 'g1',
        buildingType: 'meeting_hall',
      } as any);
      expect(service.buildBuilding).toHaveBeenCalledWith('p1', 'g1', 'meeting_hall');
      expect(result).toEqual({ id: 'b1', level: 1 });
    });

    it('getGuildBuildings passes guildId', async () => {
      service.getGuildBuildings.mockResolvedValue([]);
      const result = await controller.getGuildBuildings('g1');
      expect(service.getGuildBuildings).toHaveBeenCalledWith('g1');
      expect(result).toEqual([]);
    });

    it('adjustGuildFund passes playerId, guildId, amount and reason', async () => {
      service.adjustGuildFund.mockResolvedValue({ id: 'f1' });
      const result = await controller.adjustGuildFund(player, {
        guildId: 'g1',
        amount: 5000,
        reason: '拍卖',
      });
      expect(service.adjustGuildFund).toHaveBeenCalledWith('p1', 'g1', 5000, '拍卖');
      expect(result).toEqual({ id: 'f1' });
    });

    it('getGuildFundLogs passes guildId, page and limit', async () => {
      service.getGuildFundLogs.mockResolvedValue({ items: [], total: 0 });
      const result = await controller.getGuildFundLogs('g1', 1, 20);
      expect(service.getGuildFundLogs).toHaveBeenCalledWith('g1', 1, 20);
      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('guild activity/diplomacy endpoints', () => {
    it('createGuildActivity parses scheduleAt and passes through', async () => {
      service.createGuildActivity.mockResolvedValue({ id: 'a1' });
      const result = await controller.createGuildActivity(player, {
        guildId: 'g1',
        activityType: 'banquet',
        scheduleAt: '2026-10-01T10:00:00.000Z',
      } as any);
      expect(service.createGuildActivity).toHaveBeenCalledWith(
        'p1', 'g1', 'banquet', new Date('2026-10-01T10:00:00.000Z'),
      );
      expect(result).toEqual({ id: 'a1' });
    });

    it('getGuildActivities passes guildId', async () => {
      service.getGuildActivities.mockResolvedValue([]);
      const result = await controller.getGuildActivities('g1');
      expect(service.getGuildActivities).toHaveBeenCalledWith('g1');
      expect(result).toEqual([]);
    });

    it('setDiplomacy passes playerId, guildId, targetGuildId and relation', async () => {
      service.setDiplomacy.mockResolvedValue({ id: 'd1', relation: 'friendly' });
      const result = await controller.setDiplomacy(player, {
        guildId: 'g1',
        targetGuildId: 'g2',
        relation: 'friendly',
      } as any);
      expect(service.setDiplomacy).toHaveBeenCalledWith('p1', 'g1', 'g2', 'friendly');
      expect(result).toEqual({ id: 'd1', relation: 'friendly' });
    });

    it('getGuildDiplomacies passes guildId', async () => {
      service.getGuildDiplomacies.mockResolvedValue([]);
      const result = await controller.getGuildDiplomacies('g1');
      expect(service.getGuildDiplomacies).toHaveBeenCalledWith('g1');
      expect(result).toEqual([]);
    });
  });

  describe('guild shop/salary endpoints', () => {
    it('exchangeGuildShop passes playerId, guildId and rewardType', async () => {
      service.exchangeGuildShop.mockResolvedValue({ rewardType: 'skill_point', cost: 100 });
      const result = await controller.exchangeGuildShop(player, {
        guildId: 'g1',
        rewardType: 'skill_point',
      } as any);
      expect(service.exchangeGuildShop).toHaveBeenCalledWith('p1', 'g1', 'skill_point');
      expect(result).toEqual({ rewardType: 'skill_point', cost: 100 });
    });

    it('paySalaries passes playerId and guildId', async () => {
      service.paySalaries.mockResolvedValue({ paid: [], total: 0 });
      const result = await controller.paySalaries(player, { guildId: 'g1' });
      expect(service.paySalaries).toHaveBeenCalledWith('p1', 'g1');
      expect(result).toEqual({ paid: [], total: 0 });
    });

    it('getGuildContributionRank passes guildId', async () => {
      service.getGuildContributionRank.mockResolvedValue([]);
      const result = await controller.getGuildContributionRank('g1');
      expect(service.getGuildContributionRank).toHaveBeenCalledWith('g1');
      expect(result).toEqual([]);
    });
  });

  describe('举报/拉黑路由', () => {
    it('submitReport passes playerId, targetType, targetId, reason and content', async () => {
      service.submitReport.mockResolvedValue({ id: 'r1', status: 'pending' });
      const result = await controller.submitReport(player, {
        targetType: ReportTargetType.PLAYER,
        targetId: 'p2',
        reason: ReportReason.ABUSE,
        content: 'x',
      } as any);
      expect(service.submitReport).toHaveBeenCalledWith(
        'p1',
        ReportTargetType.PLAYER,
        'p2',
        ReportReason.ABUSE,
        'x',
      );
      expect(result).toEqual({ id: 'r1', status: 'pending' });
    });

    it('blockPlayer passes playerId and target playerId', async () => {
      service.blockPlayer.mockResolvedValue({ id: 'b1' });
      const result = await controller.blockPlayer(player, { playerId: 'p2' });
      expect(service.blockPlayer).toHaveBeenCalledWith('p1', 'p2');
      expect(result).toEqual({ id: 'b1' });
    });

    it('unblockPlayer passes playerId and target playerId', async () => {
      service.unblockPlayer.mockResolvedValue(undefined);
      const result = await controller.unblockPlayer(player, 'p2');
      expect(service.unblockPlayer).toHaveBeenCalledWith('p1', 'p2');
      expect(result).toEqual({ success: true });
    });

    it('listBlocks passes playerId, page and limit', async () => {
      service.listBlocks.mockResolvedValue({ items: [], total: 0 });
      const result = await controller.listBlocks(player, 1, 20);
      expect(service.listBlocks).toHaveBeenCalledWith('p1', 1, 20);
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('recommendFriends passes playerId and limit', async () => {
      service.recommendFriends.mockResolvedValue([]);
      const result = await controller.recommendFriends(player, 5);
      expect(service.recommendFriends).toHaveBeenCalledWith('p1', 5);
      expect(result).toEqual([]);
    });
  });
});
