import { IsString } from 'class-validator';

export class ImpeachDto {
  @IsString()
  guildId: string;
}

export class EndorseImpeachDto {
  @IsString()
  impeachmentId: string;
}
