import { IsString, IsInt, Min, Max } from 'class-validator';

export class AddRelationshipDto {
  @IsString()
  targetId: string;

  @IsInt()
  @Min(-1000)
  @Max(1000)
  favorability: number;
}
