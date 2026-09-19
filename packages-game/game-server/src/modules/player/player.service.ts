import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Player } from './entities/player.entity';
import { PlayerCurrency } from './entities/player-currency.entity';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { CurrencyType } from '@constants/enums';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';

@Injectable()
export class PlayerService {
  constructor(
    @InjectRepository(Player) private readonly playerRepo: Repository<Player>,
    @InjectRepository(PlayerCurrency)
    private readonly currencyRepo: Repository<PlayerCurrency>,
    private readonly configService: ConfigService,
    private readonly eventBus: EventBusService,
  ) {}

  async createPlayer(accountId: string, nickname: string): Promise<Player> {
    const existing = await this.playerRepo.findOne({ where: { nickname } });
    if (existing) {
      throw new GameException(ErrorCodes.NICKNAME_ALREADY_EXISTS, '昵称已存在');
    }

    const player = this.playerRepo.create({
      accountId,
      nickname,
      level: 1,
      exp: '0',
      vipLevel: 0,
      vipExp: 0,
      totalRecharge: '0',
      onlineStatus: false,
    });
    const savedPlayer = await this.playerRepo.save(player);

    const gameConfig = this.configService.get('game');
    const initialGold = gameConfig?.initialGold ?? 1000;
    const initialDiamond = gameConfig?.initialDiamond ?? 0;

    const goldCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.GOLD,
      amount: initialGold.toString(),
    });
    const diamondCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.DIAMOND,
      amount: initialDiamond.toString(),
    });
    const favorCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.FAVOR,
      amount: '0',
    });
    const guildContribCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.GUILD_CONTRIB,
      amount: '0',
    });
    const faceCurrency = this.currencyRepo.create({
      playerId: savedPlayer.id,
      currencyType: CurrencyType.FACE,
      amount: '0',
    });
    await this.currencyRepo.save([
      goldCurrency,
      diamondCurrency,
      favorCurrency,
      guildContribCurrency,
      faceCurrency,
    ]);

    return savedPlayer;
  }

  async getByAccountId(accountId: string): Promise<Player | null> {
    return this.playerRepo.findOne({ where: { accountId } });
  }

  async getById(playerId: string): Promise<Player | null> {
    return this.playerRepo.findOne({ where: { id: playerId } });
  }

  async getBaseInfo(
    playerId: string,
  ): Promise<{ player: Player; currencies: PlayerCurrency[] }> {
    const player = await this.playerRepo.findOne({ where: { id: playerId } });
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }
    const currencies = await this.currencyRepo.find({ where: { playerId } });
    return { player, currencies };
  }

  async changeNickname(playerId: string, newNickname: string): Promise<Player> {
    const existing = await this.playerRepo.findOne({
      where: { nickname: newNickname },
    });
    if (existing && existing.id !== playerId) {
      throw new GameException(ErrorCodes.NICKNAME_ALREADY_EXISTS, '昵称已存在');
    }

    const player = await this.playerRepo.findOne({ where: { id: playerId } });
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }

    player.nickname = newNickname;
    return this.playerRepo.save(player);
  }

  async findPaginated(
    page: number,
    limit: number,
  ): Promise<{ items: Player[]; total: number }> {
    const [items, total] = await this.playerRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getCurrency(
    playerId: string,
    currencyType: CurrencyType,
  ): Promise<PlayerCurrency | null> {
    return this.currencyRepo.findOne({ where: { playerId, currencyType } });
  }

  async saveCurrency(currency: PlayerCurrency): Promise<PlayerCurrency> {
    return this.currencyRepo.save(currency);
  }

  async addExp(
    playerId: string,
    exp: number,
  ): Promise<{ player: Player; leveledUp: boolean }> {
    const player = await this.playerRepo.findOne({ where: { id: playerId } });
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }
    let newExp = Number(player.exp) + exp;
    let leveledUp = false;
    while (newExp >= player.level * 1000) {
      newExp -= player.level * 1000;
      player.level += 1;
      leveledUp = true;
    }
    player.exp = newExp.toString();
    await this.playerRepo.save(player);
    if (leveledUp) {
      this.eventBus.emit(GameEvents.LEVEL_UP, {
        playerId,
        newLevel: player.level,
      });
    }
    return { player, leveledUp };
  }

  async addVipExp(
    playerId: string,
    exp: number,
  ): Promise<{ vipLevel: number; vipExp: number; leveledUp: boolean }> {
    const player = await this.playerRepo.findOne({ where: { id: playerId } });
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }
    player.vipExp += exp;
    let leveledUp = false;
    while (player.vipExp >= player.vipLevel * 1000) {
      player.vipExp -= player.vipLevel * 1000;
      player.vipLevel += 1;
      leveledUp = true;
    }
    await this.playerRepo.save(player);
    if (leveledUp) {
      this.eventBus.emit(GameEvents.VIP_LEVEL_UP, {
        playerId,
        newVipLevel: player.vipLevel,
      });
    }
    return { vipLevel: player.vipLevel, vipExp: player.vipExp, leveledUp };
  }

  async addRecharge(
    playerId: string,
    amount: string | number,
  ): Promise<Player> {
    const player = await this.playerRepo.findOne({ where: { id: playerId } });
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }
    player.totalRecharge = (
      BigInt(player.totalRecharge) + BigInt(amount)
    ).toString();
    return this.playerRepo.save(player);
  }
}
