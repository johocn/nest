import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityService } from './community.service';
import { CommunityController } from './community.controller';
import { FeedbackSuggestion, PlayerAmbassador } from './entities';
import { PlayerReport } from '@modules/social/entities/player-report.entity';
import { Player } from '@modules/player/entities/player.entity';
import {
  Character,
  TitleTemplate,
  CharacterTitle,
} from '@modules/character/entities';
import { AdminModule } from '@modules/admin/admin.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { AuthModule } from '@modules/auth/auth.module';
import { RankingModule } from '@modules/ranking/ranking.module';
import { SocialModule } from '@modules/social/social.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeedbackSuggestion,
      PlayerAmbassador,
      Player,
      PlayerReport,
      Character,
      TitleTemplate,
      CharacterTitle,
    ]),
    AdminModule,
    AnalyticsModule,
    AuthModule,
    RankingModule,
    SocialModule,
  ],
  controllers: [CommunityController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
