import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuffService } from './buff.service';
import { BuffController } from './buff-admin.controller';
import { BuffClientController } from './buff.client.controller';
import { BuffTemplate } from './entities';
import { CharacterModule } from '@modules/character/character.module';

@Module({
  imports: [TypeOrmModule.forFeature([BuffTemplate]), CharacterModule],
  controllers: [BuffController, BuffClientController],
  providers: [BuffService],
  exports: [BuffService],
})
export class BuffModule {}
