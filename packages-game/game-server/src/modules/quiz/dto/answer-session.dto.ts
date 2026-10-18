import { IsArray, IsInt, IsString, Min } from 'class-validator';

export class AnswerSessionDto {
  @IsString()
  questionId: string;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  selected: number[];
}
