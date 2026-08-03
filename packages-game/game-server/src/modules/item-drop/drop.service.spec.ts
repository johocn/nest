import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DropService } from './drop.service';
import { DropTemplate } from './entities';
import { InventoryService } from '@modules/inventory/inventory.service';
import type { Repository } from 'typeorm';

describe('DropService', () => {
  let service: DropService;
  let dropTemplateRepo: jest.Mocked<Repository<DropTemplate>>;
  let inventoryService: jest.Mocked<InventoryService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DropService,
        {
          provide: getRepositoryToken(DropTemplate),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: InventoryService,
          useValue: {
            addItem: jest.fn().mockResolvedValue({ id: '1', quantity: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get(DropService);
    dropTemplateRepo = module.get(getRepositoryToken(DropTemplate));
    inventoryService = module.get(InventoryService);
  });

  describe('rollDrop', () => {
    it('should return empty array when drop template not found', async () => {
      dropTemplateRepo.findOne.mockResolvedValue(null);

      const result = await service.rollDrop('p1', '999');

      expect(result).toEqual([]);
    });

    it('should return empty array when drop_rate check fails (dropRate=0)', async () => {
      dropTemplateRepo.findOne.mockResolvedValue({
        id: '1',
        name: 'test',
        dropItems: [{ itemTemplateId: '100', weight: 1, minQty: 1, maxQty: 1 }],
        dropRate: 0,
        maxDrops: 1,
      } as any);

      const result = await service.rollDrop('p1', '1');

      expect(result).toEqual([]);
    });

    it('should drop items when dropRate is 1.0', async () => {
      dropTemplateRepo.findOne.mockResolvedValue({
        id: '1',
        name: 'test',
        dropItems: [
          { itemTemplateId: '100', weight: 100, minQty: 1, maxQty: 3 },
        ],
        dropRate: 1.0,
        maxDrops: 1,
      } as any);

      const result = await service.rollDrop('p1', '1');

      expect(result).toHaveLength(1);
      expect(result[0].itemTemplateId).toBe('100');
      expect(result[0].quantity).toBeGreaterThanOrEqual(1);
      expect(result[0].quantity).toBeLessThanOrEqual(3);
      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'p1',
        '100',
        expect.any(Number),
        'drop',
      );
    });

    it('should respect maxDrops limit', async () => {
      dropTemplateRepo.findOne.mockResolvedValue({
        id: '1',
        name: 'multi',
        dropItems: [
          { itemTemplateId: '100', weight: 50, minQty: 1, maxQty: 1 },
          { itemTemplateId: '200', weight: 50, minQty: 1, maxQty: 1 },
          { itemTemplateId: '300', weight: 50, minQty: 1, maxQty: 1 },
        ],
        dropRate: 1.0,
        maxDrops: 2,
      } as any);

      const result = await service.rollDrop('p1', '1');

      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should use weighted random selection', async () => {
      dropTemplateRepo.findOne.mockResolvedValue({
        id: '1',
        name: 'weighted',
        dropItems: [
          { itemTemplateId: '100', weight: 99, minQty: 1, maxQty: 1 },
          { itemTemplateId: '200', weight: 1, minQty: 1, maxQty: 1 },
        ],
        dropRate: 1.0,
        maxDrops: 1,
      } as any);

      const picks: string[] = [];
      for (let i = 0; i < 50; i++) {
        const result = await service.rollDrop('p1', '1');
        if (result.length > 0) picks.push(result[0].itemTemplateId);
      }

      const count100 = picks.filter((id) => id === '100').length;
      expect(count100).toBeGreaterThan(40);
    });
  });

  describe('createDropTemplate (admin)', () => {
    it('should create a drop template', async () => {
      const data = {
        name: '哥布林掉落',
        dropItems: [
          { itemTemplateId: '100', weight: 100, minQty: 1, maxQty: 2 },
        ],
        dropRate: 0.8,
        maxDrops: 1,
      };
      dropTemplateRepo.save.mockResolvedValue({ id: '1', ...data } as any);

      const result = await service.createDropTemplate(data);

      expect(result.name).toBe('哥布林掉落');
      expect(result.dropRate).toBe(0.8);
    });
  });

  describe('getDropTemplates (admin)', () => {
    it('should return paginated templates', async () => {
      dropTemplateRepo.findAndCount.mockResolvedValue([
        [{ id: '1', name: 'test' } as any],
        1,
      ]);

      const result = await service.getDropTemplates(1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });
});
