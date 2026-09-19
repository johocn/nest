import { IsString, IsObject } from 'class-validator';

export class ArbitrationDto {
  @IsString()
  combatLogId: string;

  @IsObject()
  partiesJson: Record<string, any>;

  @IsObject()
  claimsJson: Record<string, any>;
}
