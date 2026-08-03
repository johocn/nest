import { IsEnum, IsInt, Min } from 'class-validator';
import { RankingType } from '@constants/enums';

export class QueryRankingDto {
  @IsEnum(RankingType)
  rankingType: RankingType;

  @IsInt()
  @Min(1)
  topN: number;
}
