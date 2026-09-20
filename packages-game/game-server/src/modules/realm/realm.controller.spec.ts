import { RealmController } from './realm.controller';
import { RealmAdminController } from './realm-admin.controller';

describe('RealmController', () => {
  let ctrl: RealmController;
  let adminCtrl: RealmAdminController;
  const realmService = {
    getRealmInfo: jest.fn(),
    cultivate: jest.fn(),
    breakThrough: jest.fn(),
    listTemplates: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    removeTemplate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ctrl = new RealmController(realmService as any);
    adminCtrl = new RealmAdminController(realmService as any);
  });

  it('GET my 返回境界信息', async () => {
    realmService.getRealmInfo.mockResolvedValue({
      realmLevel: 1,
      realmName: '凡体',
      realmValue: '100',
      next: { realmLevel: 2, realmName: '炼气', requiredValue: '100' },
    });
    const res = await ctrl.getMy({ playerId: 'p1' } as any);
    expect(realmService.getRealmInfo).toHaveBeenCalledWith('p1');
    expect(res.realmLevel).toBe(1);
    expect(res.next.realmLevel).toBe(2);
  });

  it('POST cultivate 转发修为投入', async () => {
    realmService.cultivate.mockResolvedValue({ realmValue: '60' });
    const res = await ctrl.cultivate({ playerId: 'p1' } as any, { amount: 50 });
    expect(realmService.cultivate).toHaveBeenCalledWith('p1', 50);
    expect(res.realmValue).toBe('60');
  });

  it('POST breakthrough 触发突破', async () => {
    realmService.breakThrough.mockResolvedValue({
      realmLevel: 2,
      realmName: '炼气',
      bonus: { strength: 50 },
      rewardDelivered: ['currency:gold:1000'],
    });
    const res = await ctrl.breakthrough({ playerId: 'p1' } as any);
    expect(realmService.breakThrough).toHaveBeenCalledWith('p1');
    expect(res.realmLevel).toBe(2);
  });

  it('admin GET templates 列境界模板', async () => {
    realmService.listTemplates.mockResolvedValue([{ id: '1' }, { id: '2' }]);
    const res = await adminCtrl.listTemplates();
    expect(res.list).toHaveLength(2);
  });

  it('admin POST templates 创建境界模板', async () => {
    realmService.createTemplate.mockResolvedValue({ id: '9' });
    await adminCtrl.createTemplate({ realmLevel: 4 } as any);
    expect(realmService.createTemplate).toHaveBeenCalledWith({ realmLevel: 4 });
  });

  it('admin PUT/DELETE templates CRUD 转发', async () => {
    await adminCtrl.updateTemplate('5', { realmName: '金丹' });
    expect(realmService.updateTemplate).toHaveBeenCalledWith('5', {
      realmName: '金丹',
    });
    const del = await adminCtrl.removeTemplate('5');
    expect(realmService.removeTemplate).toHaveBeenCalledWith('5');
    expect(del.removed).toBe('5');
  });
});