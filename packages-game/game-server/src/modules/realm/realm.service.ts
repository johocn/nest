import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealmTemplate } from './entities';
import { Character, CharacterAttribute } from '@modules/character/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { MailService } from '@modules/mail/mail.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

export interface RealmInfo {
  realmLevel: number;
  realmName: string;
  realmValue: string;
  bonus: Record<string, number>;
  next: { realmLevel: number; realmName: string; requiredValue: string } | null;
}

export interface BreakThroughResult {
  realmLevel: number;
  realmName: string;
  bonus: Record<string, number>;
  rewardDelivered: string[];
}

@Injectable()
export class RealmService {
  private readonly logger = new Logger(RealmService.name);

  constructor(
    @InjectRepository(Character)
    private readonly charRepo: Repository<Character>,
    @InjectRepository(CharacterAttribute)
    private readonly attrRepo: Repository<CharacterAttribute>,
    @InjectRepository(RealmTemplate)
    private readonly realmRepo: Repository<RealmTemplate>,
    private readonly characterService: CharacterService,
    private readonly inventoryService: InventoryService,
    private readonly economyService: EconomyService,
    private readonly mailService: MailService,
    private readonly eventBus: EventBusService,
  ) {}

  async getRealmInfo(playerId: string): Promise<RealmInfo> {
    throw new GameException(ErrorCodes.INTERNAL_ERROR, 'realm:getRealmInfo 待实现');
  }

  async cultivate(playerId: string, amount: number): Promise<{ realmValue: string }> {
    throw new GameException(ErrorCodes.INTERNAL_ERROR, 'realm:cultivate 待实现');
  }

  async breakThrough(playerId: string): Promise<BreakThroughResult> {
    throw new GameException(ErrorCodes.INTERNAL_ERROR, 'realm:breakThrough 待实现');
  }

  async createTemplate(data: Partial<RealmTemplate>): Promise<RealmTemplate> {
    const t = this.realmRepo.create(data);
    return this.realmRepo.save(t);
  }

  async updateTemplate(
    id: string,
    data: Partial<RealmTemplate>,
  ): Promise<RealmTemplate> {
    const t = await this.realmRepo.findOne({ where: { id } });
    if (!t) {
      throw new GameException(ErrorCodes.REALM_TEMPLATE_NOT_FOUND, '境界模板不存在');
    }
    Object.assign(t, data);
    return this.realmRepo.save(t);
  }

  async removeTemplate(id: string): Promise<void> {
    await this.realmRepo.delete(id);
  }

  async listTemplates(): Promise<RealmTemplate[]> {
    return this.realmRepo.find({ order: { realmLevel: 'ASC' } });
  }
}