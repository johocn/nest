import {
  IsString,
  IsEnum,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { MailSenderType } from '@constants/enums';

export class SendMailDto {
  @IsOptional()
  @IsString()
  recipientId?: string;

  @IsEnum(MailSenderType)
  senderType: MailSenderType;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  attachmentJson?: Record<string, any>;
}

export class SendBatchMailDto {
  @IsEnum(MailSenderType)
  senderType: MailSenderType;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  attachmentJson?: Record<string, any>;
}
