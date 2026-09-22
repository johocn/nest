import { WorldClientController } from './world.client.controller';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { BuildMode } from '@constants/enums';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import type { CreateBuildingRequestDto } from './dto/building.dto';

const PLAYER = { playerId: '1001' } as CurrentPlayerData;

/** 仅覆盖 Task 6 新增的建造接口（其余方法依赖未 mock 的服务，不在此跑） */
describe('WorldClientController building routes', () => {
  let controller: WorldClientController;
  let buildRuleService: { getRule: jest.Mock };
  let buildingService: {
    createBuilding: jest.Mock;
    createCoopBuilding: jest.Mock;
    listBuildings: jest.Mock;
    contribute: jest.Mock;
    demolish: jest.Mock;
  };
  let buildingAdminService: { listTemplates: jest.Mock };

  const dto = {
    sceneId: '7',
    templateId: '55',
    gx: 1,
    gy: 2,
  } as CreateBuildingRequestDto;

  beforeEach(() => {
    buildRuleService = { getRule: jest.fn() };
    buildingService = {
      createBuilding: jest.fn().mockResolvedValue({ id: '1', state: 'building' }),
      createCoopBuilding: jest.fn().mockResolvedValue({ id: '2' }),
      listBuildings: jest.fn().mockResolvedValue([]),
      contribute: jest.fn().mockResolvedValue({ reached: false }),
      demolish: jest.fn().mockResolvedValue({ refunded: false }),
    };
    buildingAdminService = { listTemplates: jest.fn().mockResolvedValue([]) };
    controller = new WorldClientController(
      {} as any,
      {} as any,
      {} as any,
      buildRuleService as any,
      buildingService as any,
      buildingAdminService as any,
    );
  });

  it('should dispatch to createCoopBuilding when rule mode is coop', async () => {
    buildRuleService.getRule.mockResolvedValue({ mode: BuildMode.COOP });
    const result = await controller.createBuilding(PLAYER, dto);
    expect(buildRuleService.getRule).toHaveBeenCalledWith('7');
    expect(buildingService.createCoopBuilding).toHaveBeenCalledWith(
      '1001',
      '7',
      dto,
    );
    expect(buildingService.createBuilding).not.toHaveBeenCalled();
    expect(result).toEqual({ id: '2' });
  });

  it('should dispatch to createBuilding when rule mode is solo', async () => {
    buildRuleService.getRule.mockResolvedValue({ mode: BuildMode.SOLO });
    await controller.createBuilding(PLAYER, dto);
    expect(buildingService.createBuilding).toHaveBeenCalledWith(
      '1001',
      '7',
      dto,
    );
    expect(buildingService.createCoopBuilding).not.toHaveBeenCalled();
  });

  it('should forward BUILD_FORBIDDEN raised by service for forbidden mode', async () => {
    buildRuleService.getRule.mockResolvedValue({ mode: BuildMode.FORBIDDEN });
    buildingService.createBuilding.mockRejectedValue(
      new GameException(ErrorCodes.BUILD_FORBIDDEN, '该场景不允许建造'),
    );

    await expect(controller.createBuilding(PLAYER, dto)).rejects.toMatchObject({
      response: { code: ErrorCodes.BUILD_FORBIDDEN },
    });
    // 控制器不自行抛错：仍走 createBuilding 入口，错误码来源单一
    expect(buildingService.createBuilding).toHaveBeenCalledWith(
      '1001',
      '7',
      dto,
    );
  });

  it('should forward ownerId filter to listBuildings only when provided', async () => {
    await controller.listBuildings('7');
    expect(buildingService.listBuildings).toHaveBeenCalledWith('7', undefined);

    await controller.listBuildings('7', '1001');
    expect(buildingService.listBuildings).toHaveBeenCalledWith('7', {
      ownerId: '1001',
    });
  });

  it('should pass contribute items and owner to service', async () => {
    const items = [{ itemTemplateId: '9', amount: 2 }];
    await controller.contributeToBuilding(PLAYER, '900', { items } as any);
    expect(buildingService.contribute).toHaveBeenCalledWith('1001', '900', items);
  });

  it('should pass player and building id to demolish', async () => {
    await controller.demolishBuilding(PLAYER, '900');
    expect(buildingService.demolish).toHaveBeenCalledWith('1001', '900');
  });

  it('should return build rule view as-is', async () => {
    const rule = { sceneId: '7', mode: BuildMode.SOLO };
    buildRuleService.getRule.mockResolvedValue(rule);
    await expect(controller.getBuildRule('7')).resolves.toBe(rule);
  });

  it('should pass only isActive:true to listTemplates when no category given', async () => {
    const templates = [{ id: '55', name: '木屋', isActive: true }];
    buildingAdminService.listTemplates.mockResolvedValue(templates);

    await expect(controller.listBuildingTemplates()).resolves.toBe(templates);
    // 客户端接口只暴露启用中的蓝图：无 category 时筛选条件必须恰好是 { isActive: true }
    expect(buildingAdminService.listTemplates).toHaveBeenCalledWith({
      isActive: true,
    });
  });

  it('should add category to listTemplates filter only when provided', async () => {
    await controller.listBuildingTemplates('house');
    expect(buildingAdminService.listTemplates).toHaveBeenCalledWith({
      isActive: true,
      category: 'house',
    });
  });
});