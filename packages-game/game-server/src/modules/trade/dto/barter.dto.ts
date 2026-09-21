import { IsObject, IsString } from 'class-validator';

/**
 * 易物道具契约：{ "<道具模板id>": <正整数数量> }
 * 例：{ "1001": 3, "1002": 1 } 表示 3 个模板 1001、1 个模板 1002。
 * 非法键/值在 TradeService.parseItemMap 处抛 PARAM_INVALID。
 */
export class CreateBarterDto {
  @IsObject()
  itemsAJson: Record<string, any>;

  @IsString()
  goldAmount: string;
}

export class AcceptBarterDto {
  @IsObject()
  itemsBJson: Record<string, any>;
}
