import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from './entities/transaction.entity';
import { PlayerService } from '@modules/player/player.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import { CurrencyType, TransactionType } from '@constants/enums';

@Injectable()
export class EconomyService {
  constructor(
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
    private readonly playerService: PlayerService,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  private static readonly SOCIAL_CURRENCIES = [
    CurrencyType.FAVOR,
    CurrencyType.GUILD_CONTRIB,
    CurrencyType.FACE,
  ];

  private async ensureCurrencyRow(
    playerId: string,
    currencyType: CurrencyType,
  ): Promise<void> {
    const currency = await this.playerService.getCurrency(playerId, currencyType);
    if (currency) return;
    await this.playerService.saveCurrency({
      playerId,
      currencyType,
      amount: '0',
    } as any);
  }

  async addCurrency(
    playerId: string,
    currencyType: CurrencyType,
    amount: number,
    source: string,
    opTrace: string,
    relatedId?: string,
  ): Promise<{ balanceAfter: string }> {
    if (amount <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '金额必须大于0');
    }

    const lockKey = `lock:currency:${playerId}:${currencyType}`;
    return this.cacheService.withLock(
      lockKey,
      async () => {
        await this.ensureCurrencyRow(playerId, currencyType);
        const currency = await this.playerService.getCurrency(
          playerId,
          currencyType,
        );
        if (!currency) {
          throw new GameException(
            ErrorCodes.CURRENCY_TYPE_INVALID,
            '货币类型不存在',
          );
        }

        const currentBalance = BigInt(currency.amount);
        const addAmount = BigInt(amount);
        const newBalance = currentBalance + addAmount;

        currency.amount = newBalance.toString();
        await this.playerService.saveCurrency(currency);

        const tx = this.txRepo.create({
          playerId,
          txType: TransactionType.EARN,
          currencyType,
          amount: addAmount.toString(),
          source,
          opTrace,
          balanceAfter: newBalance.toString(),
          relatedId: relatedId ?? null,
        });
        await this.txRepo.save(tx);

        this.eventBus.emit(GameEvents.CURRENCY_CHANGED, {
          playerId,
          currencyType,
          oldBalance: currentBalance.toString(),
          newBalance: newBalance.toString(),
          change: addAmount.toString(),
          source,
        });

        return { balanceAfter: newBalance.toString() };
      },
      { ttl: 10, retry: 3, retryDelay: 100 },
    );
  }

  async deductCurrency(
    playerId: string,
    currencyType: CurrencyType,
    amount: number,
    source: string,
    opTrace: string,
    relatedId?: string,
  ): Promise<{ balanceAfter: string }> {
    if (amount <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '金额必须大于0');
    }

    const lockKey = `lock:currency:${playerId}:${currencyType}`;
    return this.cacheService.withLock(
      lockKey,
      async () => {
        await this.ensureCurrencyRow(playerId, currencyType);
        const currency = await this.playerService.getCurrency(
          playerId,
          currencyType,
        );
        if (!currency) {
          throw new GameException(
            ErrorCodes.CURRENCY_TYPE_INVALID,
            '货币类型不存在',
          );
        }

        const currentBalance = BigInt(currency.amount);
        const deductAmount = BigInt(amount);

        if (currentBalance < deductAmount) {
          throw new GameException(ErrorCodes.CURRENCY_NOT_ENOUGH, '货币不足', {
            current: currentBalance.toString(),
            required: deductAmount.toString(),
          });
        }

        const newBalance = currentBalance - deductAmount;
        currency.amount = newBalance.toString();
        await this.playerService.saveCurrency(currency);

        const tx = this.txRepo.create({
          playerId,
          txType: TransactionType.SPEND,
          currencyType,
          amount: (-deductAmount).toString(),
          source,
          opTrace,
          balanceAfter: newBalance.toString(),
          relatedId: relatedId ?? null,
        });
        await this.txRepo.save(tx);

        this.eventBus.emit(GameEvents.CURRENCY_CHANGED, {
          playerId,
          currencyType,
          oldBalance: currentBalance.toString(),
          newBalance: newBalance.toString(),
          change: (-deductAmount).toString(),
          source,
        });

        return { balanceAfter: newBalance.toString() };
      },
      { ttl: 10, retry: 3, retryDelay: 100 },
    );
  }

  async exchange(
    playerId: string,
    from: CurrencyType,
    to: CurrencyType,
    amount: number,
  ): Promise<{ balanceAfter: string }> {
    if (amount <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '金额必须大于0');
    }
    if (from === to) {
      throw new GameException(ErrorCodes.EXCHANGE_NOT_ALLOWED, '货币相同不可兑换');
    }
    const socialOrGold = (t: CurrencyType) =>
      EconomyService.SOCIAL_CURRENCIES.includes(t) || t === CurrencyType.GOLD;
    if (socialOrGold(from) || socialOrGold(to)) {
      throw new GameException(
        ErrorCodes.EXCHANGE_NOT_ALLOWED,
        '仅钻石与绑定钻之间允许兑换（社交货币只能通过社交获取）',
      );
    }

    // 先扣后加：扣款失败直接中断；加款失败则回补，保证不丢币
    const deductResult = await this.deductCurrency(
      playerId,
      from,
      amount,
      'exchange',
      `exchange:${playerId}:${from}->${to}:${amount}`,
    );
    try {
      await this.addCurrency(
        playerId,
        to,
        amount,
        'exchange',
        `exchange:${playerId}:${from}->${to}:${amount}`,
      );
    } catch (err) {
      await this.addCurrency(
        playerId,
        from,
        amount,
        'exchange_rollback',
        `exchange:${playerId}:${from}->${to}:${amount}:rollback`,
      );
      throw err;
    }
    return deductResult;
  }

  async getBalance(
    playerId: string,
    currencyType: CurrencyType,
  ): Promise<string> {
    const currency = await this.playerService.getCurrency(
      playerId,
      currencyType,
    );
    return currency ? currency.amount : '0';
  }

  async getSocialBalances(playerId: string): Promise<Record<string, string>> {
    const [favor, guildContrib, face] = await Promise.all([
      this.getBalance(playerId, CurrencyType.FAVOR),
      this.getBalance(playerId, CurrencyType.GUILD_CONTRIB),
      this.getBalance(playerId, CurrencyType.FACE),
    ]);
    return { favor, guildContrib, face };
  }

  async getTransactions(
    playerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: Transaction[] }> {
    const items = await this.txRepo.find({
      where: { playerId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items };
  }
}
