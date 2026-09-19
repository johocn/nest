import { IsString, IsOptional } from 'class-validator';

export class ComboDto {
  @IsString()
  partnerId: string;

  @IsOptional()
  @IsString()
  combatLogId?: string;
}
