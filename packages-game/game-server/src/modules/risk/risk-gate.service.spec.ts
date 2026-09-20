import { Test } from '@nestjs/testing';
import { RiskGateService } from './risk-gate.service';
import { RiskWashService } from './risk-wash.service';
import { RiskAccountScore, RiskWhitelist } from './entities';
import { RiskLevel } from '@constants/enums';

describe('RiskGateService', () => {
  let service: RiskGateService;
  const score = new RiskAccountScore();
  const wash = {
    getAccountScore: jest.fn(),
    isWhitelisted: jest.fn(),
  };
  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [RiskGateService, { provide: RiskWashService, useValue: wash }],
    }).compile();
    service = mod.get(RiskGateService);
  });

  it('高危+起拍价超限阻断拍卖', async () => {
    score.playerId = 'p1'; score.riskScore = 80; score.level = RiskLevel.HIGH;
    wash.getAccountScore.mockResolvedValue(score);
    wash.isWhitelisted.mockResolvedValue(false);
    service['readCap'] = jest.fn().mockResolvedValue(5000);
    await expect(
      service.assertAuction('p1', '6000', 'gold'),
    ).rejects.toMatchObject({ response: { code: 93202 } });
  });

  it('高危+价值未超限放行拍卖', async () => {
    score.level = RiskLevel.HIGH;
    wash.getAccountScore.mockResolvedValue(score);
    wash.isWhitelisted.mockResolvedValue(false);
    service['readCap'] = jest.fn().mockResolvedValue(10000);
    await expect(service.assertAuction('p1', '6000', 'gold')).resolves.toBeUndefined();
  });

  it('白名单玩家豁免', async () => {
    score.level = RiskLevel.HIGH;
    wash.getAccountScore.mockResolvedValue(score);
    wash.isWhitelisted.mockResolvedValue(true);
    service['readCap'] = jest.fn().mockResolvedValue(100);
    await expect(service.assertAuction('p1', '999999', 'gold')).resolves.toBeUndefined();
  });
});