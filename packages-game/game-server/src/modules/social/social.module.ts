import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { Friend, Guild, GuildMember, GuildDonate } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Friend, Guild, GuildMember, GuildDonate]),
  ],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
