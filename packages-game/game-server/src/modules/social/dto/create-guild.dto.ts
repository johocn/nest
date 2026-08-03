import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateGuildDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;
}

export class JoinGuildDto {
  @IsString()
  guildId: string;
}

export class DonateDto {
  @IsString()
  guildId: string;

  @IsString()
  donateType: string;

  @IsString()
  amount: string;
}
