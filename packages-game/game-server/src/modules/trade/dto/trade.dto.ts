import { IsString, IsInt, IsOptional, Min, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTradeDto {
  @IsString()
  itemTemplateId: string;

  @IsString()
  itemName: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsString()
  pricePerUnit: string;

  @IsOptional()
  @IsString()
  currencyType?: string;
}

export class ListAuctionDto {
  @IsString()
  itemTemplateId: string;

  @IsString()
  itemName: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsString()
  startPrice: string;

  @IsString()
  expireAt: string;

  @IsOptional()
  @IsBoolean()
  exclusive?: boolean;
}

export class PlaceBidDto {
  @IsString()
  bidPrice: string;
}
