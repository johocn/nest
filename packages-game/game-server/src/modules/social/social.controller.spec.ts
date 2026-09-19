import { Test } from '@nestjs/testing';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { DonateType } from '@constants/enums';

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
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [{ provide: SocialService, useValue: service }],
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
});
