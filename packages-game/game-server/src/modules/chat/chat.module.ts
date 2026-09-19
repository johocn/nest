import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import {
  ChatMessage,
  ChatPlayerStat,
  ChatSignIn,
  SupportTicket,
  VoiceRoom,
} from './entities';
import { Player } from '@modules/player/entities/player.entity';
import { Friend } from '@modules/social/entities/friend.entity';
import { GuildMember } from '@modules/social/entities/guild-member.entity';
import { ConfigManageModule } from '@modules/config/config.module';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatMessage,
      ChatPlayerStat,
      ChatSignIn,
      SupportTicket,
      VoiceRoom,
      Player,
      Friend,
      GuildMember,
    ]),
    ConfigManageModule,
    forwardRef(() => AdminModule),
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
