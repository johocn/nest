import {
  IsString,
  IsEnum,
  IsBoolean,
  IsInt,
  IsOptional,
  IsDate,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
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

  /** 生效时间：为空视为立即生效 */
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startAt?: Date;

  /** 失效时间：为空视为永久有效 */
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endAt?: Date;
}
