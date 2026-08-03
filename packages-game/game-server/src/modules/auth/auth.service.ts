import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { AuthAccount } from './entities/auth-account.entity';
import { AccountLoginLog } from './entities/account-login-log.entity';
import { PlayerService } from '@modules/player/player.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { AccountType, AccountStatus } from '@constants/enums';

export interface JwtPayload {
  accountId: string;
  playerId: string;
  tokenVersion: number;
  type: 'player';
}

export interface AuthResult {
  token: string;
  accountId: string;
  playerId: string;
}

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(
    @InjectRepository(AuthAccount)
    private readonly accountRepo: Repository<AuthAccount>,
    @InjectRepository(AccountLoginLog)
    private readonly loginLogRepo: Repository<AccountLoginLog>,
    private readonly playerService: PlayerService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const jwtConfig = this.configService.get('jwt');
    this.jwtSecret = jwtConfig?.secret ?? 'default-secret';
    this.jwtExpiresIn = jwtConfig?.expiresIn ?? '7d';
  }

  async register(
    username: string,
    password: string,
    nickname: string,
    deviceId?: string,
  ): Promise<AuthResult> {
    const existing = await this.accountRepo.findOne({ where: { username } });
    if (existing) {
      throw new GameException(
        ErrorCodes.USERNAME_ALREADY_EXISTS,
        '用户名已存在',
      );
    }

    const passwordHash = await this.hashPassword(password);
    const account = this.accountRepo.create({
      username,
      passwordHash,
      accountType: AccountType.NORMAL,
      deviceId: deviceId ?? null,
      tokenVersion: 0,
      status: AccountStatus.ACTIVE,
    });
    const savedAccount = await this.accountRepo.save(account);
    const player = await this.playerService.createPlayer(
      savedAccount.id,
      nickname,
    );
    const token = this.generateToken(
      savedAccount.id,
      player.id,
      savedAccount.tokenVersion,
    );

    return { token, accountId: savedAccount.id, playerId: player.id };
  }

  async login(
    username: string,
    password: string,
    loginIp: string,
    deviceInfo?: string,
  ): Promise<AuthResult> {
    const account = await this.accountRepo.findOne({ where: { username } });
    if (!account) {
      await this.recordLoginLog(null, loginIp, deviceInfo, 'fail');
      throw new GameException(ErrorCodes.ACCOUNT_NOT_FOUND, '账号不存在');
    }

    if (account.status === AccountStatus.BANNED) {
      if (!account.banExpireAt || account.banExpireAt > new Date()) {
        throw new GameException(ErrorCodes.ACCOUNT_BANNED, '账号已被封禁', {
          banReason: account.banReason,
          banExpireAt: account.banExpireAt,
        });
      }
      await this.accountRepo.update(
        { id: account.id },
        { status: AccountStatus.ACTIVE, banReason: null, banExpireAt: null },
      );
      account.status = AccountStatus.ACTIVE;
    }

    const isPasswordValid = await this.comparePassword(
      password,
      account.passwordHash,
    );
    if (!isPasswordValid) {
      await this.recordLoginLog(account.id, loginIp, deviceInfo, 'fail');
      throw new GameException(ErrorCodes.ACCOUNT_PASSWORD_WRONG, '密码错误');
    }

    const player = await this.playerService.getByAccountId(account.id);
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家档案不存在');
    }

    const newTokenVersion = account.tokenVersion + 1;
    await this.accountRepo.update(
      { id: account.id },
      { tokenVersion: newTokenVersion, lastLoginAt: new Date() },
    );
    await this.recordLoginLog(account.id, loginIp, deviceInfo, 'success');

    const token = this.generateToken(account.id, player.id, newTokenVersion);
    return { token, accountId: account.id, playerId: player.id };
  }

  async createGuest(loginIp: string, deviceInfo?: string): Promise<AuthResult> {
    const guestUsername = `guest_${randomUUID().slice(0, 12)}`;
    const guestPassword = randomUUID();
    const nickname = `Guest_${randomUUID().slice(0, 6)}`;

    const passwordHash = await this.hashPassword(guestPassword);
    const account = this.accountRepo.create({
      username: guestUsername,
      passwordHash,
      accountType: AccountType.GUEST,
      deviceId: deviceInfo ?? null,
      tokenVersion: 0,
      status: AccountStatus.ACTIVE,
    });
    const savedAccount = await this.accountRepo.save(account);
    const player = await this.playerService.createPlayer(
      savedAccount.id,
      nickname,
    );
    await this.recordLoginLog(savedAccount.id, loginIp, deviceInfo, 'success');
    const token = this.generateToken(
      savedAccount.id,
      player.id,
      savedAccount.tokenVersion,
    );

    return { token, accountId: savedAccount.id, playerId: player.id };
  }

  async validateToken(payload: JwtPayload): Promise<boolean> {
    const account = await this.accountRepo.findOne({
      where: { id: payload.accountId },
    });
    if (!account) return false;
    if (account.status === AccountStatus.BANNED) return false;
    if (account.tokenVersion !== payload.tokenVersion) return false;
    return true;
  }

  async getAccountById(accountId: string): Promise<AuthAccount | null> {
    return this.accountRepo.findOne({ where: { id: accountId } });
  }

  private generateToken(
    accountId: string,
    playerId: string,
    tokenVersion: number,
  ): string {
    const payload: JwtPayload = {
      accountId,
      playerId,
      tokenVersion,
      type: 'player',
    };
    return this.jwtService.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: this.jwtExpiresIn,
    } as JwtSignOptions);
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  private async comparePassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private async recordLoginLog(
    accountId: string | null,
    loginIp: string,
    deviceInfo: string | undefined,
    result: 'success' | 'fail',
  ): Promise<void> {
    const log = this.loginLogRepo.create({
      accountId: accountId ?? '0',
      loginIp,
      deviceInfo: deviceInfo ?? null,
      loginResult: result,
    });
    await this.loginLogRepo.save(log);
  }
}
