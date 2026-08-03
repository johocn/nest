import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthAccount } from './entities/auth-account.entity';
import { AccountLoginLog } from './entities/account-login-log.entity';
import { PlayerService } from '@modules/player/player.service';
import { GameException } from '@common/exceptions/game.exception';
import { AccountType, AccountStatus } from '@constants/enums';

describe('AuthService', () => {
  let service: AuthService;

  const mockAccountRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockLoginLogRepo = {
    create: jest.fn(),
    save: jest.fn(),
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
      return undefined;
    }),
  };

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
