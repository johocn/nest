import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ChatChannel } from '@constants/enums';

export class SendChatDto {
  @IsEnum(ChatChannel)
  channel: ChatChannel;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  recipientId?: string;

  @IsOptional()
  @IsString()
  guildId?: string;
}
