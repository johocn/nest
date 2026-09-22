import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BuildingAdminService } from './building-admin.service';
import { BuildRuleService } from './build-rule.service';
import { BuildingTemplate } from '../entities/building-template.entity';
import { BuildingInstance } from '../entities/building-instance.entity';
import { SceneBuildRule } from '../entities/scene-build-rule.entity';
import { BuildMode, BuildingState, BuildingOwnerType } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';

const GRID_SIZE = 64;

async function expectGameCode(
  promise: Promise<any>,
  code: number,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ response: { code } });
}

describe('BuildingAdminService', () => {
  let service: BuildingAdminService;
  let templateRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let buildingRepo: { find: jest.Mock };
  let ruleRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let buildRule: { getRule: jest.Mock; toCenter: jest.Mock };

  const makeTemplate = (overrides: Record<string, any> = {}): any => ({
    id: '55',
    name: '小屋',
    resKey: 'house',
    category: 'house',
    footprintW: 1,
    footprintH: 1,
    buildCost: [],
    buildSeconds: 60,
    durability: 100,
    effect: {},
    unlockCondition: null,
    isActive: true,
    ...overrides,
  });

  const upsertDto = (overrides: Record<string, any> = {}): any => ({
    name: '木栅栏',
    resKey: 'fence',
    category: 'deco',
    footprintW: 2,
    footprintH: 1,
    buildCost: [{ itemTemplateId: '9', amount: 3 }],
    buildSeconds: 30,
    durability: 50,
    ...overrides,
  });

  beforeEach(async () => {
    templateRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    buildingRepo = { find: jest.fn().mockResolvedValue([]) };
    ruleRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    buildRule = {
      getRule: jest.fn().mockResolvedValue({
        id: '9',
        sceneId: '7',
        mode: BuildMode.SOLO,
        landGridSize: GRID_SIZE,
        maxBuildingsPerPlayer: 5,
        allowDemolish: true,
        coopMinContributors: 2,
        coopExpireHours: 24,
        reservedZones: [],
      }),
      toCenter: jest.fn((gx: number, gy: number, gridSize: number) => ({
        x: (gx + 0.5) * gridSize,
        y: (gy + 0.5) * gridSize,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildingAdminService,
        { provide: getRepositoryToken(BuildingTemplate), useValue: templateRepo },
        { provide: getRepositoryToken(BuildingInstance), useValue: buildingRepo },
        { provide: getRepositoryToken(SceneBuildRule), useValue: ruleRepo },
        { provide: BuildRuleService, useValue: buildRule },
      ],
    }).compile();

    service = module.get(BuildingAdminService);
  });

  describe('listTemplates', () => {
    it('should pass category/isActive filters to repository', async () => {
      await service.listTemplates({ category: 'house', isActive: true });
      expect(templateRepo.find).toHaveBeenCalledWith({
        where: { category: 'house', isActive: true },
        order: { id: 'ASC' },
      });
    });

    it('should query all when no filter given', async () => {
      await service.listTemplates();
      expect(templateRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { id: 'ASC' },
      });
    });
  });

  describe('createTemplate', () => {
    it('should persist blueprint with defaults for optional fields', async () => {
      const result = await service.createTemplate(upsertDto());
      expect(templateRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '木栅栏',
          resKey: 'fence',
          category: 'deco',
          footprintW: 2,
          footprintH: 1,
          buildSeconds: 30,
          durability: 50,
          effect: {},
          unlockCondition: null,
          isActive: true,
        }),
      );
      expect(result.name).toBe('木栅栏');
    });
  });

  describe('updateTemplate', () => {
    it('should throw BUILD_NOT_FOUND when blueprint missing', async () => {
      templateRepo.findOne.mockResolvedValue(null);
      await expectGameCode(
        service.updateTemplate('404', upsertDto()),
        ErrorCodes.BUILD_NOT_FOUND,
      );
    });

    it('should overwrite fields of existing blueprint', async () => {
      templateRepo.findOne.mockResolvedValue(makeTemplate());
      await service.updateTemplate('55', upsertDto({ isActive: false }));
      expect(templateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '55',
          name: '木栅栏',
          footprintW: 2,
          isActive: false,
        }),
      );
    });
  });

  describe('toggleTemplate', () => {
    it('should flip isActive when omitted', async () => {
      templateRepo.findOne.mockResolvedValue(makeTemplate({ isActive: true }));
      const saved = await service.toggleTemplate('55');
      expect(saved.isActive).toBe(false);
    });

    it('should honour explicit isActive=false', async () => {
      templateRepo.findOne.mockResolvedValue(makeTemplate({ isActive: true }));
      const saved = await service.toggleTemplate('55', false);
      expect(saved.isActive).toBe(false);
    });

    it('should throw BUILD_NOT_FOUND when blueprint missing', async () => {
      templateRepo.findOne.mockResolvedValue(null);
      await expectGameCode(
        service.toggleTemplate('404', true),
        ErrorCodes.BUILD_NOT_FOUND,
      );
    });
  });

  describe('upsertRule', () => {
    it('should insert when rule row absent', async () => {
      ruleRepo.findOne.mockResolvedValue(null);
      const view = {
        id: '1',
        sceneId: '7',
        mode: BuildMode.COOP,
        landGridSize: GRID_SIZE,
        maxBuildingsPerPlayer: 5,
        allowDemolish: true,
        coopMinContributors: 3,
        coopExpireHours: 24,
        reservedZones: [],
      };
      buildRule.getRule.mockResolvedValue(view);

      const result = await service.upsertRule('7', {
        mode: BuildMode.COOP,
        coopMinContributors: 3,
      } as any);

      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneId: '7',
          mode: BuildMode.COOP,
          coopMinContributors: 3,
        }),
      );
      // 返回值统一来自 BuildRuleService.getRule 视图（不自造结构）
      expect(buildRule.getRule).toHaveBeenCalledWith('7');
      expect(result).toBe(view);
    });

    it('should update existing row keeping untouched fields', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: '9',
        sceneId: '7',
        mode: BuildMode.SOLO,
        landGridSize: GRID_SIZE,
        maxBuildingsPerPlayer: 5,
        allowDemolish: true,
        coopMinContributors: 2,
        coopExpireHours: 24,
        reservedZones: [],
      });
      await service.upsertRule('7', { mode: BuildMode.COOP } as any);
      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: BuildMode.COOP,
          maxBuildingsPerPlayer: 5,
          landGridSize: GRID_SIZE,
        }),
      );
      expect(ruleRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('listInstances', () => {
    it('should map filters sceneId/playerId/state to repository where', async () => {
      await service.listInstances({
        sceneId: '7',
        playerId: '1001',
        state: BuildingState.BUILT,
      });
      expect(buildingRepo.find).toHaveBeenCalledWith({
        where: { sceneId: '7', ownerId: '1001', state: BuildingState.BUILT },
        order: { id: 'ASC' },
      });
    });

    it('should convert grid payload to pixel view like BuildingService', async () => {
      buildingRepo.find.mockResolvedValue([
        {
          id: '900',
          sceneId: '7',
          templateId: '55',
          ownerType: BuildingOwnerType.PLAYER,
          ownerId: '1001',
          state: BuildingState.BUILDING,
          finishAt: new Date('2026-09-23T00:00:00.000Z'),
          durability: 100,
          payload: { gx: 1, gy: 2, w: 2, h: 3 },
        },
      ]);
      const views = await service.listInstances();
      expect(buildRule.toCenter).toHaveBeenCalledWith(1, 2, GRID_SIZE);
      expect(views).toEqual([
        {
          id: '900',
          sceneId: '7',
          templateId: '55',
          ownerId: '1001',
          state: BuildingState.BUILDING,
          finishAt: '2026-09-23T00:00:00.000Z',
          x: 96,
          y: 160,
          w: 2,
          h: 3,
        },
      ]);
    });

    it('should resolve grid size per scene once', async () => {
      buildingRepo.find.mockResolvedValue([
        { id: '1', sceneId: '7', templateId: '55', ownerId: '1', state: 'built', finishAt: null, payload: {} },
        { id: '2', sceneId: '7', templateId: '55', ownerId: '1', state: 'built', finishAt: null, payload: {} },
      ]);
      await service.listInstances({ sceneId: '7' });
      expect(buildRule.getRule).toHaveBeenCalledTimes(1);
    });
  });
});