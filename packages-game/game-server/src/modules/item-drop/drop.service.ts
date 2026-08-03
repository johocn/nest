import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DropTemplate } from './entities';
import { InventoryService } from '@modules/inventory/inventory.service';

export interface DropResult {
  itemTemplateId: string;
  quantity: number;
}

@Injectable()
export class DropService {
  constructor(
    @InjectRepository(DropTemplate)
    private readonly dropRepo: Repository<DropTemplate>,
    private readonly inventoryService: InventoryService,
  ) {}

  async rollDrop(
    playerId: string,
    dropTemplateId: string,
  ): Promise<DropResult[]> {
    const template = await this.dropRepo.findOne({
      where: { id: dropTemplateId },
    });
    if (!template) {
      return [];
    }

    if (Math.random() > template.dropRate) {
      return [];
    }

    if (!template.dropItems || template.dropItems.length === 0) {
      return [];
    }

    const results: DropResult[] = [];
    const remainingItems = [...template.dropItems];

    for (let i = 0; i < template.maxDrops && remainingItems.length > 0; i++) {
      const totalWeight = remainingItems.reduce(
        (sum, item) => sum + item.weight,
        0,
      );
      let random = Math.random() * totalWeight;

      let selectedIndex = 0;
      for (let j = 0; j < remainingItems.length; j++) {
        random -= remainingItems[j].weight;
        if (random <= 0) {
          selectedIndex = j;
          break;
        }
      }

      const selected = remainingItems.splice(selectedIndex, 1)[0];
      const quantity =
        selected.minQty +
        Math.floor(Math.random() * (selected.maxQty - selected.minQty + 1));

      if (quantity > 0) {
        results.push({ itemTemplateId: selected.itemTemplateId, quantity });
        await this.inventoryService.addItem(
          playerId,
          selected.itemTemplateId,
          quantity,
          'drop',
        );
      }
    }

    return results;
  }

  async getDropTemplates(
    page: number,
    limit: number,
  ): Promise<{ items: DropTemplate[]; total: number }> {
    const [items, total] = await this.dropRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getDropTemplate(id: string): Promise<DropTemplate | null> {
    return this.dropRepo.findOne({ where: { id } });
  }

  async createDropTemplate(data: Partial<DropTemplate>): Promise<DropTemplate> {
    const template = this.dropRepo.create(data);
    return this.dropRepo.save(template);
  }

  async updateDropTemplate(
    id: string,
    data: Partial<DropTemplate>,
  ): Promise<DropTemplate | null> {
    const template = await this.dropRepo.findOne({ where: { id } });
    if (!template) {
      return null;
    }
    Object.assign(template, data);
    return this.dropRepo.save(template);
  }
}
