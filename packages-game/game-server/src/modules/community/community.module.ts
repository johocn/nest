import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityService } from './community.service';
import { CommunityController } from './community.controller';
import { FeedbackSuggestion, PlayerAmbassador } from './entities';
import { Player } from '@modules/player/entities/player.entity';
import {
  Character,
  TitleTemplate,
  CharacterTitle,
} from '@modules/character/entities';
import { AdminModule } from '@modules/admin/admin.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeedbackSuggestion,
      PlayerAmbassador,
      Player,
      Character,
      TitleTemplate,
      CharacterTitle,
    ]),
    AdminModule,
    AnalyticsModule,
  ],
  controllers: [CommunityController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
