import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import {
  ItemTemplate,
  InventoryItem,
  CharacterEquipment,
  PlayerItemChangeLog,
} from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  ItemType,
  ItemRarity,
  BindType,
  BindStatus,
  EquipmentSlot,
  ItemChangeType,
} from '@constants/enums';
import type { Repository } from 'typeorm';

describe('InventoryService', () => {
  let service: InventoryService;
  let itemTemplateRepo: jest.Mocked<Repository<ItemTemplate>>;
  let inventoryItemRepo: jest.Mocked<Repository<InventoryItem>>;
  let equipmentRepo: jest.Mocked<Repository<CharacterEquipment>>;
  let changeLogRepo: jest.Mocked<Repository<PlayerItemChangeLog>>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const createMockRepo = () => ({
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn((data: any) => ({ ...data, id: '1' })),
      delete: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(ItemTemplate),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(InventoryItem),
          useValue: { ...createMockRepo(), query: jest.fn() },
        },
        {
          provide: getRepositoryToken(CharacterEquipment),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(PlayerItemChangeLog),
          useValue: createMockRepo(),
        },
        {
          provide: CacheService,
          useValue: { withLock: jest.fn((_, cb) => cb()) },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryService);
    itemTemplateRepo = module.get(getRepositoryToken(ItemTemplate));
    inventoryItemRepo = module.get(getRepositoryToken(InventoryItem));
    equipmentRepo = module.get(getRepositoryToken(CharacterEquipment));
    changeLogRepo = module.get(getRepositoryToken(PlayerItemChangeLog));
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  const makeTemplate = (overrides: Partial<ItemTemplate> = {}): ItemTemplate =>
    ({
      id: '100',
      name: '测试道具',
      itemType: ItemType.MATERIAL,
      rarity: ItemRarity.COMMON,
      maxStack: 99,
      sellPrice: '10',
      canTrade: true,
      canDrop: true,
      bindType: BindType.NONE,
      description: null,
      configJson: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as ItemTemplate;

  describe('addItem', () => {
    it('should create new inventory item when player has none', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate());
      inventoryItemRepo.findOne.mockResolvedValue(null);
      inventoryItemRepo.save.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 5,
      } as any);

      const result = await service.addItem('p1', '100', 5, 'test');

      expect(result.quantity).toBe(5);
      expect(inventoryItemRepo.save).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'inventory.item.acquired',
        expect.objectContaining({
          playerId: 'p1',
          itemTemplateId: '100',
          quantity: 5,
        }),
      );
    });

    it('should stack onto existing item when quantity < maxStack', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ maxStack: 99 }),
      );
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 50,
        bindStatus: BindStatus.UNBOUND,
      } as any);
      inventoryItemRepo.save.mockResolvedValue({
        id: '1',
        quantity: 60,
      } as any);

      const result = await service.addItem('p1', '100', 10, 'test');

      expect(result.quantity).toBe(60);
    });

    it('should bind on pickup when template bindType is BIND_ON_PICKUP', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ bindType: BindType.BIND_ON_PICKUP }),
      );
      inventoryItemRepo.findOne.mockResolvedValue(null);
      inventoryItemRepo.save.mockImplementation(
        async (data: any) => ({ ...data, id: '1' }) as any,
      );

      const result = await service.addItem('p1', '100', 1, 'test');

      expect(result.bindStatus).toBe(BindStatus.BOUND);
    });

    it('should throw when item template not found', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(null);

      await expect(service.addItem('p1', '999', 1, 'test')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('removeItem', () => {
    it('should reduce quantity when enough items', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate());
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 10,
        bindStatus: BindStatus.UNBOUND,
      } as any);
      inventoryItemRepo.save.mockResolvedValue({ id: '1', quantity: 5 } as any);

      const result = await service.removeItem('p1', '100', 5, 'consume');

      expect(result.quantity).toBe(5);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'inventory.item.consumed',
        expect.objectContaining({
          playerId: 'p1',
          itemTemplateId: '100',
          quantity: 5,
        }),
      );
    });

    it('should throw when insufficient quantity', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate());
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 3,
      } as any);

      await expect(
        service.removeItem('p1', '100', 5, 'consume'),
      ).rejects.toThrow(GameException);
    });

    it('should throw when item not found', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate());
      inventoryItemRepo.findOne.mockResolvedValue(null);

      await expect(
        service.removeItem('p1', '100', 1, 'consume'),
      ).rejects.toThrow(GameException);
    });

    it('should use distributed lock', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate());
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 10,
      } as any);
      inventoryItemRepo.save.mockResolvedValue({ id: '1', quantity: 5 } as any);

      await service.removeItem('p1', '100', 5, 'consume');

      expect(cacheService.withLock).toHaveBeenCalledWith(
        expect.stringContaining('lock:item:p1:100'),
        expect.any(Function),
        expect.any(Object),
      );
    });
  });

  describe('removeUnboundItem', () => {
    it('should deduct from unbound stack and write change log', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate({ canTrade: true }));
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 10,
        bindStatus: BindStatus.UNBOUND,
      } as any);
      inventoryItemRepo.save.mockImplementation((data: any) =>
        Promise.resolve(data),
      );

      const result = await service.removeUnboundItem('p1', '100', 4, 'trade.test');

      expect(result.quantity).toBe(6);
      expect(changeLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: -4, opTrace: 'trade.test' }),
      );
    });

    it('should reject with ITEM_BOUND when only bound stack exists', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate({ canTrade: true }));
      inventoryItemRepo.findOne
        .mockResolvedValueOnce(null) // UNBOUND 行不存在
        .mockResolvedValueOnce({ id: '1', bindStatus: BindStatus.BOUND } as any);

      await expect(
        service.removeUnboundItem('p1', '100', 1, 'trade.test'),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.ITEM_BOUND } });
    });

    it('should reject with ITEM_CANNOT_TRADE when template forbids trade', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(
        makeTemplate({ canTrade: false }),
      );

      await expect(
        service.removeUnboundItem('p1', '100', 1, 'trade.test'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.ITEM_CANNOT_TRADE },
      });
      expect(inventoryItemRepo.findOne).not.toHaveBeenCalled();
    });

    it('should reject with ITEM_NOT_ENOUGH when unbound stack is insufficient', async () => {
      itemTemplateRepo.findOne.mockResolvedValue(makeTemplate({ canTrade: true }));
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 2,
        bindStatus: BindStatus.UNBOUND,
      } as any);

      await expect(
        service.removeUnboundItem('p1', '100', 5, 'trade.test'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.ITEM_NOT_ENOUGH },
      });
    });
  });

  describe('useItem', () => {
    it('should consume item and return effect from configJson', async () => {
      const template = makeTemplate({
        itemType: ItemType.CONSUMABLE,
        configJson: { effect: { heal: 50 } },
      });
      itemTemplateRepo.findOne.mockResolvedValue(template);
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 2,
        bindStatus: BindStatus.UNBOUND,
      } as any);
      inventoryItemRepo.save.mockResolvedValue({ id: '1', quantity: 1 } as any);

      const result = await service.useItem('p1', '100');

      expect(result.effect).toEqual({ heal: 50 });
      expect(result.remaining).toBe(1);
    });

    it('should throw when item type is not consumable', async () => {
      const template = makeTemplate({ itemType: ItemType.EQUIPMENT });
      itemTemplateRepo.findOne.mockResolvedValue(template);
      inventoryItemRepo.findOne.mockResolvedValue({
        id: '1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 1,
      } as any);

      await expect(service.useItem('p1', '100')).rejects.toThrow(GameException);
    });
  });

  describe('equipItem', () => {
    it('should equip item to correct slot', async () => {
      const template = makeTemplate({
        itemType: ItemType.EQUIPMENT,
        configJson: { slot: EquipmentSlot.WEAPON },
      });
      itemTemplateRepo.findOne.mockResolvedValue(template);
      inventoryItemRepo.findOne.mockResolvedValue({
        id: 'inv1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 1,
        bindStatus: BindStatus.UNBOUND,
      } as any);
      equipmentRepo.findOne.mockResolvedValue(null);
      equipmentRepo.save.mockResolvedValue({
        id: 'eq1',
        characterId: 'c1',
        slot: EquipmentSlot.WEAPON,
        inventoryItemId: 'inv1',
      } as any);
      inventoryItemRepo.save.mockResolvedValue({
        id: 'inv1',
        quantity: 0,
      } as any);

      const result = await service.equipItem('c1', 'inv1');

      expect(result.slot).toBe(EquipmentSlot.WEAPON);
    });

    it('should throw when item is not equipment type', async () => {
      const template = makeTemplate({ itemType: ItemType.CONSUMABLE });
      itemTemplateRepo.findOne.mockResolvedValue(template);
      inventoryItemRepo.findOne.mockResolvedValue({
        id: 'inv1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 1,
      } as any);

      await expect(service.equipItem('c1', 'inv1')).rejects.toThrow(
        GameException,
      );
    });

    it('should throw when slot already occupied', async () => {
      const template = makeTemplate({
        itemType: ItemType.EQUIPMENT,
        configJson: { slot: EquipmentSlot.WEAPON },
      });
      itemTemplateRepo.findOne.mockResolvedValue(template);
      inventoryItemRepo.findOne.mockResolvedValue({
        id: 'inv1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 1,
      } as any);
      equipmentRepo.findOne.mockResolvedValue({
        id: 'old',
        characterId: 'c1',
        slot: EquipmentSlot.WEAPON,
        inventoryItemId: 'old_inv',
      } as any);

      await expect(service.equipItem('c1', 'inv1')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('unequipItem', () => {
    it('should remove equipment and restore item to bag', async () => {
      equipmentRepo.findOne.mockResolvedValue({
        id: 'eq1',
        characterId: 'c1',
        slot: EquipmentSlot.WEAPON,
        inventoryItemId: 'inv1',
      } as any);
      inventoryItemRepo.findOne.mockResolvedValue({
        id: 'inv1',
        playerId: 'p1',
        itemTemplateId: '100',
        quantity: 0,
      } as any);
      inventoryItemRepo.save.mockResolvedValue({
        id: 'inv1',
        quantity: 1,
      } as any);
      equipmentRepo.delete.mockResolvedValue({ affected: 1, raw: {} } as any);

      const result = await service.unequipItem('c1', EquipmentSlot.WEAPON);

      expect(result.quantity).toBe(1);
      expect(equipmentRepo.delete).toHaveBeenCalledWith('eq1');
    });
  });

  describe('getInventory', () => {
    it('should return all items for player', async () => {
      const items = [
        { id: '1', playerId: 'p1', quantity: 5 },
        { id: '2', playerId: 'p1', quantity: 3 },
      ];
      inventoryItemRepo.find.mockResolvedValue(items as any);

      const result = await service.getInventory('p1');

      expect(result).toHaveLength(2);
    });
  });

  describe('getEquipment', () => {
    it('should return all equipped items for character', async () => {
      const equips = [
        { id: '1', characterId: 'c1', slot: EquipmentSlot.WEAPON },
      ];
      equipmentRepo.find.mockResolvedValue(equips as any);

      const result = await service.getEquipment('c1');

      expect(result).toHaveLength(1);
    });
  });
});
