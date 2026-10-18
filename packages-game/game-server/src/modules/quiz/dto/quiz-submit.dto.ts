import { IsArray, IsInt, IsString, Min } from 'class-validator';

export class SubmitQuizDto {
  @IsString()
  questionId: string;

  /** 选项下标从 0 起 */
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  selected: number[];
}
