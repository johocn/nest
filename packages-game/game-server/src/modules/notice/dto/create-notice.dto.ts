import {
  IsString,
  IsEnum,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { NoticeType } from '@constants/enums';

export class CreateNoticeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  title: string;

  @IsString()
  content: string;

  @IsEnum(NoticeType)
  noticeType: NoticeType;

  @IsBoolean()
  isActive: boolean;

  @IsInt()
  @Min(0)
  sortOrder: number;
}
