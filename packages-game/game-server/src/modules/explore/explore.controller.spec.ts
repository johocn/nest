import { ExploreController } from './explore.client.controller';
import { ExploreAdminController } from './explore-admin.controller';

describe('ExploreController', () => {
  let ctrl: ExploreController;
  let adminCtrl: ExploreAdminController;
  const exploreService = {
    worldState: jest.fn(),
    discover: jest.fn(),
    triggerEncounter: jest.fn(),
    resolveEncounter: jest.fn(),
    listTemplates: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    removeTemplate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ctrl = new ExploreController(exploreService as any);
    adminCtrl = new ExploreAdminController(exploreService as any);
  });

  it('GET state 返回昼夜天气', async () => {
    exploreService.worldState.mockResolvedValue({
      timeOfDay: 'day',
      weather: 'sunny',
      hour: '10',
    });
    const res = await ctrl.state();
    expect(res.timeOfDay).toBe('day');
    expect(res.weather).toBe('sunny');
  });

  it('POST scene/:sceneId/discover 转发探索', async () => {
    exploreService.discover.mockResolvedValue({
      sceneId: 's1',
      times: 1,
      first: true,
      delivered: ['currency:gold:100'],
    });
    const res = await ctrl.discover({ playerId: 'p1' } as any, 's1');
    expect(exploreService.discover).toHaveBeenCalledWith('p1', 's1');
    expect(res.first).toBe(true);
  });

  it('POST scene/:sceneId/encounter 触发奇遇', async () => {
    exploreService.triggerEncounter.mockResolvedValue({
      encounterId: 'e1',
      hit: true,
      options: [{ id: 'a', label: '选择A' }],
    });
    const res = await ctrl.triggerEncounter({ playerId: 'p1' } as any, 's1');
    expect(exploreService.triggerEncounter).toHaveBeenCalledWith('p1', 's1');
    expect(res.hit).toBe(true);
  });

  it('POST encounter/:id/resolve 结算奇遇', async () => {
    exploreService.resolveEncounter.mockResolvedValue({
      encounterId: 'e1',
      choiceId: 'a',
      delivered: ['currency:gold:100'],
    });
    const res = await ctrl.resolve(
      { playerId: 'p1' } as any,
      'e1',
      { choice: 'a' } as any,
    );
    expect(exploreService.resolveEncounter).toHaveBeenCalledWith(
      'p1',
      'e1',
      'a',
    );
    expect(res.delivered).toContain('currency:gold:100');
  });

  it('admin GET templates 列奇遇模板', async () => {
    exploreService.listTemplates.mockResolvedValue([{ id: '1' }, { id: '2' }]);
    const res = await adminCtrl.listTemplates();
    expect(res.list).toHaveLength(2);
  });

  it('admin POST/PUT/DELETE templates CRUD', async () => {
    exploreService.createTemplate.mockResolvedValue({ id: '9' });
    await adminCtrl.createTemplate({ sceneId: 's1' } as any);
    expect(exploreService.createTemplate).toHaveBeenCalledWith({ sceneId: 's1' });

    await adminCtrl.updateTemplate('5', { triggerRate: 0.2 });
    expect(exploreService.updateTemplate).toHaveBeenCalledWith('5', {
      triggerRate: 0.2,
    });

    const del = await adminCtrl.removeTemplate('5');
    expect(exploreService.removeTemplate).toHaveBeenCalledWith('5');
    expect(del.removed).toBe('5');
  });
});