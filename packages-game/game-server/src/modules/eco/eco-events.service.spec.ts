import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac } from 'crypto';
import { EcoEventsService } from './eco-events.service';
import { EcoEventDto } from './dto/eco-event.dto';
import { AuthAccount } from '@modules/auth/entities/auth-account.entity';
import { Player } from '@modules/player/entities/player.entity';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

const SECRET = 'test-shared-secret';
const BODY =
  '{"action":"view_article","scope":"joho","ssoId":"12","targetId":"1024","extra":{}}';

function sign(rawBody: string, ts: string): string {
  return createHmac('sha256', SECRET)
    .update(`${rawBody}|${ts}`)
    .digest('hex');
}

function makeDto(overrides: Partial<EcoEventDto> = {}): EcoEventDto {
  return {
    action: 'view_article',
    scope: 'joho',
    ssoId: '12',
    targetId: '1024',
    extra: {},
    ...overrides,
  } as EcoEventDto;
}

async function expectCode(promise: Promise<unknown>, code: number) {
  try {
    await promise;
    fail('应抛出 GameException');
  } catch (e) {
    expect(e).toBeInstanceOf(GameException);
    expect((e as GameException).getResponse()).toMatchObject({ code });
  }
}

describe('EcoEventsService', () => {
  let service: EcoEventsService;
  const accountRepo = { findOne: jest.fn() };
  const playerRepo = { findOne: jest.fn() };
  const cacheService = { acquireLock: jest.fn() };
  const eventBus = { emit: jest.fn() };

  const nowTs = () => Math.floor(Date.now() / 1000).toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EcoEventsService,
        { provide: getRepositoryToken(AuthAccount), useValue: accountRepo },
        { provide: getRepositoryToken(Player), useValue: playerRepo },
        { provide: CacheService, useValue: cacheService },
        { provide: EventBusService, useValue: eventBus },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(SECRET) },
        },
      ],
    }).compile();
    service = moduleRef.get<EcoEventsService>(EcoEventsService);
  });

  it('签名正确时通过并返回 success', async () => {
    accountRepo.findOne.mockResolvedValue({ id: '1' });
    playerRepo.findOne.mockResolvedValue({ id: '7' });
    cacheService.acquireLock.mockResolvedValue(true);
    const ts = nowTs();
    const result = await service.handle(BODY, ts, sign(BODY, ts), makeDto());
    expect(result).toEqual({ success: true });
    expect(cacheService.acquireLock).toHaveBeenCalledWith(
      expect.stringMatching(/^eco:evt:/),
      300,
    );
  });

  it('body 被篡改时拒绝 91601', async () => {
    const ts = nowTs();
    const tamperedBody =
      '{"action":"view_article","scope":"joho","ssoId":"12","targetId":"9999","extra":{}}';
    await expectCode(
      service.handle(tamperedBody, ts, sign(BODY, ts), makeDto()),
      ErrorCodes.ECO_SIGN_INVALID,
    );
  });

  it('过期时间戳拒绝 91601', async () => {
    const oldTs = (Math.floor(Date.now() / 1000) - 600).toString();
    await expectCode(
      service.handle(BODY, oldTs, sign(BODY, oldTs), makeDto()),
      ErrorCodes.ECO_SIGN_INVALID,
    );
  });

  it('重放上报拒绝 91602', async () => {
    cacheService.acquireLock.mockResolvedValue(false);
    const ts = nowTs();
    await expectCode(
      service.handle(BODY, ts, sign(BODY, ts), makeDto()),
      ErrorCodes.ECO_REPLAY,
    );
  });

  it('未知 action 拒绝 91604', async () => {
    cacheService.acquireLock.mockResolvedValue(true);
    const ts = nowTs();
    const dto = makeDto({ action: 'hack' as EcoEventDto['action'] });
    await expectCode(
      service.handle(BODY, ts, sign(BODY, ts), dto),
      ErrorCodes.ECO_UNKNOWN_ACTION,
    );
  });

  it('ssoId 无对应玩家时静默成功且不分发事件', async () => {
    accountRepo.findOne.mockResolvedValue(null);
    cacheService.acquireLock.mockResolvedValue(true);
    const ts = nowTs();
    const result = await service.handle(BODY, ts, sign(BODY, ts), makeDto());
    expect(result).toEqual({ success: true });
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('事件分发 payload 正确', async () => {
    accountRepo.findOne.mockResolvedValue({ id: '1' });
    playerRepo.findOne.mockResolvedValue({ id: '7' });
    cacheService.acquireLock.mockResolvedValue(true);
    const ts = nowTs();
    await service.handle(BODY, ts, sign(BODY, ts), makeDto());
    expect(eventBus.emit).toHaveBeenCalledWith(GameEvents.ECO_ACTION, {
      playerId: '7',
      action: 'view_article',
      scope: 'joho',
      targetId: '1024',
      extra: {},
    });
  });

  it('未配置 ECO_SHARED_SECRET 时拒绝 91601', async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EcoEventsService,
        { provide: getRepositoryToken(AuthAccount), useValue: accountRepo },
        { provide: getRepositoryToken(Player), useValue: playerRepo },
        { provide: CacheService, useValue: cacheService },
        { provide: EventBusService, useValue: eventBus },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();
    const noSecretService = moduleRef.get<EcoEventsService>(EcoEventsService);
    const ts = nowTs();
    await expectCode(
      noSecretService.handle(BODY, ts, sign(BODY, ts), makeDto()),
      ErrorCodes.ECO_SIGN_INVALID,
    );
  });
});
