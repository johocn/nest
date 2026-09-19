import { IsString, MaxLength } from 'class-validator';

export class IntelInquireDto {
  @IsString()
  @MaxLength(128)
  topic: string;
}
