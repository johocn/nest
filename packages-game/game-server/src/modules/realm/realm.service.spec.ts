import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RealmService } from './realm.service';
import { RealmTemplate } from './entities';
import { Character, CharacterAttribute } from '@modules/character/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { MailService } from '@modules/mail/mail.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

describe('RealmService', () => {
  let service: RealmService;

  const charRepo = {
    findOne: jest.fn(),
    create: jest.fn((r: any) => ({ ...r })),
    save: jest.fn((r: any) => Promise.resolve({ ...r })),
  };
  const attrRepo = {
    findOne: jest.fn(),
    create: jest.fn((r: any) => ({ ...r })),
    save: jest.fn((r: any) => Promise.resolve({ ...r })),
  };
  const realmRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((r: any) => ({ ...r })),
    save: jest.fn((r: any) => Promise.resolve({ ...r, id: r.id ?? '9' })),
  };
  const characterService = { getByPlayerId: jest.fn() };
  const inventoryService = { removeItem: jest.fn(), addItem: jest.fn() };
  const economyService = { addCurrency: jest.fn() };
  const mailService = { sendMail: jest.fn() };
  const eventBus = { emit: jest.fn() };

  const templates: RealmTemplate[] = [
    {
      id: '1',
      realmLevel: 1,
      realmName: '凡体',
      requiredValue: '0',
      consumeItemsJson: [],
      statBonusJson: { strength: 0 },
      milestoneRewardJson: {},
    },
    {
      id: '2',
      realmLevel: 2,
      realmName: '炼气',
      requiredValue: '100',
      consumeItemsJson: [{ itemTemplateId: 'realm-item', quantity: 1 }],
      statBonusJson: { strength: 50 },
      milestoneRewardJson: { currency: [{ currencyType: 'gold', amount: 1000 }] },
    },
    {
      id: '3',
      realmLevel: 3,
      realmName: '筑基',
      requiredValue: '200',
      consumeItemsJson: [],
      statBonusJson: { strength: 120 },
      milestoneRewardJson: { currency: [{ currencyType: 'gold', amount: 3000 }] },
    },
  ] as unknown as RealmTemplate[];

  beforeEach(async () => {
    jest.clearAllMocks();
    realmRepo.find.mockResolvedValue(templates);
    const mod = await Test.createTestingModule({
      providers: [
        RealmService,
        { provide: getRepositoryToken(Character), useValue: charRepo },
        { provide: getRepositoryToken(CharacterAttribute), useValue: attrRepo },
        { provide: getRepositoryToken(RealmTemplate), useValue: realmRepo },
        { provide: CharacterService, useValue: characterService },
        { provide: InventoryService, useValue: inventoryService },
        { provide: EconomyService, useValue: economyService },
        { provide: MailService, useValue: mailService },
        { provide: EventBusService, useValue: eventBus },
      ],
    }).compile();
    service = mod.get(RealmService);
  });

  it('cultivate 累加修为并回写角色', async () => {
    characterService.getByPlayerId.mockResolvedValue({
      id: 'c1',
      playerId: 'p1',
      realmLevel: 1,
      realmValue: '10',
      milestoneClaimedJson: [],
    });
    const res = await service.cultivate('p1', 50);
    expect(res.realmValue).toBe('60');
    expect(charRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ realmValue: '60' }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.stringMatching(/realm\.value\.gained/),
      expect.anything(),
    );
  });

  it('breakThrough 达标 → 消耗道具 → 升级 → 属性覆盖叠加 → 里程碑发奖', async () => {
    characterService.getByPlayerId.mockResolvedValue({
      id: 'c1',
      playerId: 'p1',
      realmLevel: 1,
      realmValue: '100',
      milestoneClaimedJson: [],
    });
    attrRepo.findOne.mockResolvedValue({
      id: 'a1',
      characterId: 'c1',
      strength: 10,
      speed: 10,
      defense: 10,
    });
    inventoryService.removeItem.mockResolvedValue({});
    economyService.addCurrency.mockResolvedValue({ balanceAfter: '1000' });

    const res = await service.breakThrough('p1');
    expect(res.realmLevel).toBe(2);
    expect(res.realmName).toBe('炼气');
    expect(charRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ realmLevel: 2, realmValue: '0' }),
    );
    // 消耗了境界专用养成道具
    expect(inventoryService.removeItem).toHaveBeenCalledWith(
      'p1',
      'realm-item',
      1,
      expect.any(String),
    );
    // 属性覆盖叠加：level1 bonus 0 → level2 bonus 50，强度 += 50
    expect(attrRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ strength: 60 }),
    );
    // 里程碑发奖经既有 economy 通道，且只发一次
    expect(economyService.addCurrency).toHaveBeenCalledTimes(1);
    expect(economyService.addCurrency).toHaveBeenCalledWith(
      'p1',
      'gold',
      1000,
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
    // 记录已领取的里程碑 level
    expect(charRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ milestoneClaimedJson: [2] }),
    );
  });

  it('breakThrough 未达阈值抛 REALM_VALUE_NOT_ENOUGH', async () => {
    characterService.getByPlayerId.mockResolvedValue({
      id: 'c1',
      playerId: 'p1',
      realmLevel: 1,
      realmValue: '50',
      milestoneClaimedJson: [],
    });
    await expect(service.breakThrough('p1')).rejects.toBeInstanceOf(GameException);
    await expect(service.breakThrough('p1')).rejects.toThrow(/修为/);
  });

  it('breakThrough 里程碑按 realm_level 幂等不重复发奖', async () => {
    // level2 已领取过，重复突破到 level2 不再发奖
    characterService.getByPlayerId.mockResolvedValue({
      id: 'c1',
      playerId: 'p1',
      realmLevel: 1,
      realmValue: '100',
      milestoneClaimedJson: [2],
    });
    attrRepo.findOne.mockResolvedValue({
      id: 'a1',
      characterId: 'c1',
      strength: 10,
      speed: 10,
      defense: 10,
    });
    inventoryService.removeItem.mockResolvedValue({});

    await service.breakThrough('p1');
    expect(economyService.addCurrency).not.toHaveBeenCalled();
    expect(charRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ milestoneClaimedJson: [2] }),
    );
  });

  it('breakThrough 满级抛 REALM_ALREADY_MAX', async () => {
    characterService.getByPlayerId.mockResolvedValue({
      id: 'c1',
      playerId: 'p1',
      realmLevel: 3,
      realmValue: '99999',
      milestoneClaimedJson: [2, 3],
    });
    await expect(service.breakThrough('p1')).rejects.toThrow(/满级/);
  });
});