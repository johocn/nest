import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ItemTemplate,
  InventoryItem,
  CharacterEquipment,
  PlayerItemChangeLog,
} from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import {
  ItemType,
  BindType,
  BindStatus,
  EquipmentSlot,
  ItemChangeType,
} from '@constants/enums';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(ItemTemplate)
    private readonly templateRepo: Repository<ItemTemplate>,
    @InjectRepository(InventoryItem)
    private readonly itemRepo: Repository<InventoryItem>,
    @InjectRepository(CharacterEquipment)
    private readonly equipRepo: Repository<CharacterEquipment>,
    @InjectRepository(PlayerItemChangeLog)
    private readonly logRepo: Repository<PlayerItemChangeLog>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async addItem(
    playerId: string,
    itemTemplateId: string,
    quantity: number,
    opTrace: string,
  ): Promise<InventoryItem> {
    if (quantity <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '数量必须大于0');
    }
    if (!/^\d+$/.test(itemTemplateId)) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }

    const template = await this.templateRepo.findOne({
      where: { id: itemTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }

    const existing = await this.itemRepo.findOne({
      where: { playerId, itemTemplateId, bindStatus: BindStatus.UNBOUND },
    });

    const shouldBind = template.bindType === BindType.BIND_ON_PICKUP;
    let item: InventoryItem;

    if (existing && !shouldBind && existing.quantity < template.maxStack) {
      existing.quantity += quantity;
      if (existing.quantity > template.maxStack) {
        existing.quantity = template.maxStack;
      }
      item = await this.itemRepo.save(existing);
    } else {
      item = this.itemRepo.create({
        playerId,
        itemTemplateId,
        quantity,
        slotIndex: 0,
        bindStatus: shouldBind ? BindStatus.BOUND : BindStatus.UNBOUND,
        expireAt: null,
        extraAttrs: null,
      });
      item = await this.itemRepo.save(item);
    }

    await this.logRepo.save(
      this.logRepo.create({
        playerId,
        itemTemplateId,
        changeType: ItemChangeType.ADD,
        quantity,
        opTrace,
        balanceAfter: item.quantity,
      }),
    );

    this.eventBus.emit(GameEvents.ITEM_ACQUIRED, {
      playerId,
      itemTemplateId,
      quantity,
    });

    return item;
  }

  async removeItem(
    playerId: string,
    itemTemplateId: string,
    quantity: number,
    opTrace: string,
  ): Promise<InventoryItem> {
    if (quantity <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '数量必须大于0');
    }
    if (!/^\d+$/.test(itemTemplateId)) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }

    const lockKey = `lock:item:${playerId}:${itemTemplateId}`;
    return this.cacheService.withLock(
      lockKey,
      async () => {
        const item = await this.itemRepo.findOne({
          where: { playerId, itemTemplateId },
        });
        if (!item) {
          throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具不存在');
        }

        if (item.quantity < quantity) {
          throw new GameException(ErrorCodes.ITEM_NOT_ENOUGH, '道具数量不足', {
            current: item.quantity,
            required: quantity,
          });
        }

        item.quantity -= quantity;
        const saved = await this.itemRepo.save(item);

        await this.logRepo.save(
          this.logRepo.create({
            playerId,
            itemTemplateId,
            changeType: ItemChangeType.REMOVE,
            quantity: -quantity,
            opTrace,
            balanceAfter: saved.quantity,
          }),
        );

        this.eventBus.emit(GameEvents.ITEM_CONSUMED, {
          playerId,
          itemTemplateId,
          quantity,
        });

        return saved;
      },
      { ttl: 10, retry: 3, retryDelay: 100 },
    );
  }

  /**
   * 交易/拍卖/易物专用扣减：只认「未绑定」堆。
   * 手册 11.2：绑定道具禁止交易流通，故不能复用 removeItem（后者不区分 bindStatus）。
   */
  async removeUnboundItem(
    playerId: string,
    itemTemplateId: string,
    quantity: number,
    opTrace: string,
  ): Promise<InventoryItem> {
    if (quantity <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '数量必须大于0');
    }
    if (!/^\d+$/.test(itemTemplateId)) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }

    const template = await this.templateRepo.findOne({
      where: { id: itemTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }
    if (template.canTrade === false) {
      throw new GameException(ErrorCodes.ITEM_CANNOT_TRADE, '该道具禁止交易');
    }

    const lockKey = `lock:item:${playerId}:${itemTemplateId}`;
    return this.cacheService.withLock(
      lockKey,
      async () => {
        const item = await this.itemRepo.findOne({
          where: {
            playerId,
            itemTemplateId,
            bindStatus: BindStatus.UNBOUND,
          },
        });
        if (!item) {
          // 区分「没有该道具」与「有但已绑定」，便于运营定位
          const anyItem = await this.itemRepo.findOne({
            where: { playerId, itemTemplateId },
          });
          throw new GameException(
            anyItem ? ErrorCodes.ITEM_BOUND : ErrorCodes.ITEM_NOT_FOUND,
            anyItem ? '道具已绑定，禁止交易流通' : '道具不存在',
          );
        }

        if (item.quantity < quantity) {
          throw new GameException(ErrorCodes.ITEM_NOT_ENOUGH, '道具数量不足', {
            current: item.quantity,
            required: quantity,
          });
        }

        item.quantity -= quantity;
        const saved = await this.itemRepo.save(item);

        await this.logRepo.save(
          this.logRepo.create({
            playerId,
            itemTemplateId,
            changeType: ItemChangeType.REMOVE,
            quantity: -quantity,
            opTrace,
            balanceAfter: saved.quantity,
          }),
        );

        this.eventBus.emit(GameEvents.ITEM_CONSUMED, {
          playerId,
          itemTemplateId,
          quantity,
        });

        return saved;
      },
      { ttl: 10, retry: 3, retryDelay: 100 },
    );
  }

  async useItem(
    playerId: string,
    itemTemplateId: string,
  ): Promise<{ effect: Record<string, any>; remaining: number }> {
    if (!/^\d+$/.test(itemTemplateId)) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }
    const template = await this.templateRepo.findOne({
      where: { id: itemTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }

    if (template.itemType !== ItemType.CONSUMABLE) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '该道具不可使用');
    }

    const item = await this.itemRepo.findOne({
      where: { playerId, itemTemplateId },
    });
    if (!item || item.quantity < 1) {
      throw new GameException(ErrorCodes.ITEM_NOT_ENOUGH, '道具数量不足');
    }

    if (
      template.bindType === BindType.BIND_ON_USE &&
      item.bindStatus === BindStatus.UNBOUND
    ) {
      item.bindStatus = BindStatus.BOUND;
    }

    item.quantity -= 1;
    const saved = await this.itemRepo.save(item);

    await this.logRepo.save(
      this.logRepo.create({
        playerId,
        itemTemplateId,
        changeType: ItemChangeType.REMOVE,
        quantity: -1,
        opTrace: 'use_item',
        balanceAfter: saved.quantity,
      }),
    );

    this.eventBus.emit(GameEvents.ITEM_CONSUMED, {
      playerId,
      itemTemplateId,
      quantity: 1,
    });

    return {
      effect: template.configJson?.effect ?? {},
      remaining: saved.quantity,
    };
  }

  async equipItem(
    characterId: string,
    inventoryItemId: string,
  ): Promise<CharacterEquipment> {
    const item = await this.itemRepo.findOne({
      where: { id: inventoryItemId },
    });
    if (!item) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '背包道具不存在');
    }

    const template = await this.templateRepo.findOne({
      where: { id: item.itemTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }

    if (template.itemType !== ItemType.EQUIPMENT) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '该道具不是装备');
    }

    const slot = template.configJson?.slot as EquipmentSlot;
    if (!slot) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '装备未配置槽位');
    }

    const existing = await this.equipRepo.findOne({
      where: { characterId, slot },
    });
    if (existing) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        '该槽位已有装备，请先卸下',
      );
    }

    if (
      template.bindType !== BindType.NONE &&
      item.bindStatus === BindStatus.UNBOUND
    ) {
      item.bindStatus = BindStatus.BOUND;
      await this.itemRepo.save(item);
    }

    const equipment = this.equipRepo.create({
      characterId,
      slot,
      inventoryItemId,
    });
    return this.equipRepo.save(equipment);
  }

  async unequipItem(
    characterId: string,
    slot: EquipmentSlot,
  ): Promise<InventoryItem> {
    const equipment = await this.equipRepo.findOne({
      where: { characterId, slot },
    });
    if (!equipment) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '该槽位无装备');
    }

    const item = await this.itemRepo.findOne({
      where: { id: equipment.inventoryItemId },
    });
    if (item) {
      item.quantity = 1;
      await this.itemRepo.save(item);
    }

    await this.equipRepo.delete(equipment.id);

    return item!;
  }

  async getInventory(playerId: string): Promise<InventoryItem[]> {
    return this.itemRepo.find({ where: { playerId } });
  }

  async getEquipment(characterId: string): Promise<CharacterEquipment[]> {
    return this.equipRepo.find({ where: { characterId } });
  }

  async getTemplate(id: string): Promise<ItemTemplate | null> {
    return this.templateRepo.findOne({ where: { id } });
  }

  async getTemplates(
    page: number,
    limit: number,
  ): Promise<{ items: ItemTemplate[]; total: number }> {
    const [items, total] = await this.templateRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async createTemplate(data: Partial<ItemTemplate>): Promise<ItemTemplate> {
    const template = this.templateRepo.create(data);
    return this.templateRepo.save(template);
  }

  async updateTemplate(
    id: string,
    data: Partial<ItemTemplate>,
  ): Promise<ItemTemplate> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) {
      throw new GameException(ErrorCodes.ITEM_NOT_FOUND, '道具模板不存在');
    }
    Object.assign(template, data);
    return this.templateRepo.save(template);
  }
}
