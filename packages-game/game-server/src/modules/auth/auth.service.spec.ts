import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthAccount } from './entities/auth-account.entity';
import { AccountLoginLog } from './entities/account-login-log.entity';
import { PlayerService } from '@modules/player/player.service';
import { GameException } from '@common/exceptions/game.exception';
import { AccountType, AccountStatus, PenaltyLevel } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { AccountPenalty } from './entities/account-penalty.entity';
import { AccountSecurityEvent } from './entities/account-security-event.entity';

const mockAccountRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

const mockLoginLogRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
};

const mockPlayerService = {
  createPlayer: jest.fn(),
  getByAccountId: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'jwt') return { secret: 'test-secret', expiresIn: '7d' };
    if (key === 'SSO_BASE_URL') return 'https://sso.test.local';
    if (key === 'SSO_CALLBACK_URL')
      return 'https://game.test.local/api/client/v1/auth/sso/callback';
    return undefined;
  }),
};

const mockPenaltyRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve(v)),
  find: jest.fn(() => Promise.resolve([])),
  findOne: jest.fn(() => Promise.resolve(null)),
};

const mockSecurityEventRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve(v)),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(AuthAccount), useValue: mockAccountRepo },
        {
          provide: getRepositoryToken(AccountLoginLog),
          useValue: mockLoginLogRepo,
        },
        {
          provide: getRepositoryToken(AccountPenalty),
          useValue: mockPenaltyRepo,
        },
        {
          provide: getRepositoryToken(AccountSecurityEvent),
          useValue: mockSecurityEventRepo,
        },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = moduleRef.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should register a new account', async () => {
    mockAccountRepo.findOne.mockResolvedValue(null);
    mockAccountRepo.create.mockImplementation((data) => data);
    mockAccountRepo.save.mockImplementation(async (data) => ({
      ...data,
      id: '1',
    }));
    mockPlayerService.createPlayer.mockResolvedValue({
      id: 'p1',
      nickname: 'Hero',
    });

    const result = await service.register('newuser', 'password123', 'Hero');

    expect(result.token).toBe('mock-jwt-token');
    expect(result.accountId).toBe('1');
    expect(result.playerId).toBe('p1');
    expect(mockPlayerService.createPlayer).toHaveBeenCalledWith('1', 'Hero');
  });

  it('should throw if username already exists', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      username: 'existing',
    });
    await expect(service.register('existing', 'pass', 'Nick')).rejects.toThrow(
      GameException,
    );
  });

  it('should login successfully and increment token version', async () => {
    const mockAccount = {
      id: '1',
      username: 'testuser',
      passwordHash: '$2b$10$mockhash',
      tokenVersion: 0,
      status: AccountStatus.ACTIVE,
      banExpireAt: null,
    };
    mockAccountRepo.findOne.mockResolvedValue(mockAccount);
    mockPlayerService.getByAccountId.mockResolvedValue({ id: 'p1' });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);

    const result = await service.login(
      'testuser',
      'password123',
      '127.0.0.1',
      'device-1',
    );

    expect(result.token).toBe('mock-jwt-token');
    expect(result.accountId).toBe('1');
    expect(result.playerId).toBe('p1');
    expect(mockAccountRepo.update).toHaveBeenCalledWith(
      { id: '1' },
      expect.objectContaining({ tokenVersion: 1 }),
    );
  });

  it('should throw if account not found on login', async () => {
    mockAccountRepo.findOne.mockResolvedValue(null);
    await expect(service.login('ghost', 'pass', '127.0.0.1')).rejects.toThrow(
      GameException,
    );
  });

  it('should throw if password wrong', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      username: 'testuser',
      passwordHash: '$2b$10$mockhash',
      status: AccountStatus.ACTIVE,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(false);
    await expect(
      service.login('testuser', 'wrongpass', '127.0.0.1'),
    ).rejects.toThrow(GameException);
  });

  it('should throw if account is banned', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      username: 'banned',
      passwordHash: '$2b$10$mockhash',
      status: AccountStatus.BANNED,
      banExpireAt: null,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);
    await expect(service.login('banned', 'pass', '127.0.0.1')).rejects.toThrow(
      GameException,
    );
  });

  it('should create guest account', async () => {
    mockAccountRepo.findOne.mockResolvedValue(null);
    mockAccountRepo.create.mockImplementation((data) => data);
    mockAccountRepo.save.mockImplementation(async (data) => ({
      ...data,
      id: '2',
    }));
    mockPlayerService.createPlayer.mockResolvedValue({
      id: 'p2',
      nickname: 'Guest_abc',
    });

    const result = await service.createGuest('127.0.0.1', 'device-1');

    expect(result.token).toBe('mock-jwt-token');
    expect(result.accountId).toBe('2');
  });

  it('should validate token with correct token version', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      tokenVersion: 5,
      status: AccountStatus.ACTIVE,
      banExpireAt: null,
    });
    const result = await service.validateToken({
      accountId: '1',
      tokenVersion: 5,
      type: 'player',
    });
    expect(result).toBe(true);
  });

  it('should reject token with stale token version', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      tokenVersion: 6,
      status: AccountStatus.ACTIVE,
      banExpireAt: null,
    });
    const result = await service.validateToken({
      accountId: '1',
      tokenVersion: 5,
      type: 'player',
    });
    expect(result).toBe(false);
  });
});

describe('账号安全扩展', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(AuthAccount), useValue: mockAccountRepo },
        {
          provide: getRepositoryToken(AccountLoginLog),
          useValue: mockLoginLogRepo,
        },
        {
          provide: getRepositoryToken(AccountPenalty),
          useValue: mockPenaltyRepo,
        },
        {
          provide: getRepositoryToken(AccountSecurityEvent),
          useValue: mockSecurityEventRepo,
        },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('applyPenalty 禁言写冗余列并留痕', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      mutedUntil: null,
      tradeLockedUntil: null,
      status: AccountStatus.ACTIVE,
    });
    mockPenaltyRepo.findOne.mockResolvedValue(null);
    mockAccountRepo.update.mockResolvedValue({});

    await service.applyPenalty('gm1', '1', '1', PenaltyLevel.MUTE, '骂人', 3600);

    expect(mockPenaltyRepo.save).toHaveBeenCalled();
    expect(mockAccountRepo.update).toHaveBeenCalledWith(
      { id: '1' },
      expect.objectContaining({ mutedUntil: expect.any(Date) }),
    );
  });

  it('封禁不降级（新等级序号必须高于当前）', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      mutedUntil: new Date(),
      tradeLockedUntil: null,
      status: AccountStatus.ACTIVE,
    });
    mockPenaltyRepo.findOne.mockResolvedValue({ level: PenaltyLevel.BAN });

    await expect(
      service.applyPenalty('gm1', '1', '1', PenaltyLevel.MUTE, '降级尝试', 3600),
    ).rejects.toMatchObject({
      response: { code: ErrorCodes.PENALTY_LEVEL_INVALID },
    });
  });

  it('bindRealName 加密存储且脱敏查询', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      realName: null,
      idNoHash: null,
    });
    mockAccountRepo.save.mockImplementation((v) => Promise.resolve(v));

    await service.bindRealName('1', '张三', '110101199001011234');
    const saved = mockAccountRepo.save.mock.calls[0][0];
    expect(saved.realName).not.toContain('张三');
    expect(saved.idNoHash).toHaveLength(64);

    const status = await service.getSecurityStatus('1');
    expect(status.realNameMasked).toContain('*');
  });

  it('getAccountRestrictions 到期自动解除', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '1',
      mutedUntil: new Date(Date.now() - 1000),
      tradeLockedUntil: null,
    });
    mockAccountRepo.update.mockResolvedValue({});

    const res = await service.getAccountRestrictions('1');
    expect(res.mutedUntil).toBeNull();
    expect(mockAccountRepo.update).toHaveBeenCalledWith(
      { id: '1' },
      { mutedUntil: null },
    );
  });
});

describe('SSO 登录', () => {
  let service: AuthService;
  const mockFetch = jest.fn();

  const buildMock = (body: unknown) => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => body,
    } as Response);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(AuthAccount), useValue: mockAccountRepo },
        {
          provide: getRepositoryToken(AccountLoginLog),
          useValue: mockLoginLogRepo,
        },
        {
          provide: getRepositoryToken(AccountPenalty),
          useValue: mockPenaltyRepo,
        },
        {
          provide: getRepositoryToken(AccountSecurityEvent),
          useValue: mockSecurityEventRepo,
        },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('buildSsoLoginUrl 拼接 authorize 参数（默认回调）', () => {
    const url = service.buildSsoLoginUrl();
    expect(url).toBe(
      'https://sso.test.local/api/zhao-sso/v1/auth/authorize?app_code=game&redirect_uri=' +
        encodeURIComponent(
          'https://game.test.local/api/client/v1/auth/sso/callback',
        ) +
        '&response_type=code',
    );
  });

  it('buildSsoLoginUrl 支持自定义 redirect 参数', () => {
    const url = service.buildSsoLoginUrl('https://game.test.local/after-sso');
    expect(url).toContain(
      'redirect_uri=' +
        encodeURIComponent('https://game.test.local/after-sso'),
    );
  });

  it('换码成功自动建档并签发 token', async () => {
    buildMock({ user: { uuid: 'sso-uuid-1', username: 'sso_hero' } });
    mockAccountRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.ssoId) return Promise.resolve(null);
      if (where.username) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    mockAccountRepo.create.mockImplementation((data) => data);
    mockAccountRepo.save.mockImplementation(async (data) => ({
      ...data,
      id: '100',
    }));
    mockPlayerService.createPlayer.mockResolvedValue({
      id: 'p100',
      nickname: 'sso_hero',
    });
    mockPlayerService.getByAccountId.mockResolvedValue({ id: 'p100' });
    mockAccountRepo.update.mockResolvedValue({});
    jest.spyOn(service as any, 'hashPassword').mockResolvedValue('hash');

    const result = await service.handleSsoCallback('auth-code-1');

    expect(result.token).toBe('mock-jwt-token');
    expect(result.accountId).toBe('100');
    expect(result.playerId).toBe('p100');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://sso.test.local/api/zhao-sso/v1/auth/exchange-token',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"code":"auth-code-1"'),
      }),
    );
    expect(mockAccountRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'sso_hero',
        accountType: AccountType.SSO,
        ssoId: 'sso-uuid-1',
        ssoProvider: 'zhao-sso',
      }),
    );
    expect(mockPlayerService.createPlayer).toHaveBeenCalledWith(
      '100',
      'sso_hero',
    );
    expect(mockAccountRepo.update).toHaveBeenCalledWith(
      { id: '100' },
      expect.objectContaining({ tokenVersion: 1 }),
    );
  });

  it('ssoId 已存在时幂等复用并签发 token', async () => {
    buildMock({ user: { uuid: 'sso-uuid-1', username: 'sso_hero' } });
    mockAccountRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.ssoId)
        return Promise.resolve({
          id: '50',
          username: 'sso_hero',
          tokenVersion: 3,
          status: AccountStatus.ACTIVE,
        });
      return Promise.resolve(null);
    });
    mockPlayerService.getByAccountId.mockResolvedValue({ id: 'p50' });
    mockAccountRepo.update.mockResolvedValue({});

    const result = await service.handleSsoCallback('auth-code-2');

    expect(result.accountId).toBe('50');
    expect(result.playerId).toBe('p50');
    expect(mockAccountRepo.update).toHaveBeenCalledWith(
      { id: '50' },
      expect.objectContaining({ tokenVersion: 4 }),
    );
    expect(mockPlayerService.createPlayer).not.toHaveBeenCalled();
    expect(mockAccountRepo.create).not.toHaveBeenCalled();
  });

  it('用户名与既有账号冲突时追加 _g1 后缀', async () => {
    buildMock({ user: { uuid: 'sso-uuid-2', username: 'hero' } });
    mockAccountRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.ssoId) return Promise.resolve(null);
      if (where.username === 'hero')
        return Promise.resolve({ id: '9', username: 'hero' });
      return Promise.resolve(null);
    });
    mockAccountRepo.create.mockImplementation((data) => data);
    mockAccountRepo.save.mockImplementation(async (data) => ({
      ...data,
      id: '101',
    }));
    mockPlayerService.createPlayer.mockResolvedValue({ id: 'p101' });
    mockPlayerService.getByAccountId.mockResolvedValue({ id: 'p101' });
    mockAccountRepo.update.mockResolvedValue({});
    jest.spyOn(service as any, 'hashPassword').mockResolvedValue('hash');

    const result = await service.handleSsoCallback('auth-code-3');

    expect(mockAccountRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'hero_g1', ssoId: 'sso-uuid-2' }),
    );
    expect(result.accountId).toBe('101');
  });

  it('网络异常时换码失败抛 SSO_AUTH_FAILED', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    await expect(service.handleSsoCallback('bad-code')).rejects.toMatchObject({
      response: { code: ErrorCodes.SSO_AUTH_FAILED },
    });
  });

  it('换码返回非 2xx 时抛 SSO_AUTH_FAILED', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    } as Response);
    await expect(service.handleSsoCallback('bad-code')).rejects.toMatchObject({
      response: { code: ErrorCodes.SSO_AUTH_FAILED },
    });
  });

  it('换码返回缺少用户信息时抛 SSO_AUTH_FAILED', async () => {
    buildMock({ error: 'invalid_grant' });
    await expect(service.handleSsoCallback('bad-code')).rejects.toMatchObject({
      response: { code: ErrorCodes.SSO_AUTH_FAILED },
    });
  });
});
