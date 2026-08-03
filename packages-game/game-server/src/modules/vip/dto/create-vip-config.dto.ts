import { IsInt, IsObject, Min } from 'class-validator';

export class CreateVipConfigDto {
  @IsInt()
  @Min(0)
  level: number;

  @IsInt()
  @Min(0)
  requiredExp: number;

  @IsObject()
  dailyRewardJson: Record<string, any>;

  @IsObject()
  privilegeJson: Record<string, any>;
}
