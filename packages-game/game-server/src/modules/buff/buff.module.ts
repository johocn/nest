import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuffService } from './buff.service';
import { BuffController } from './buff.controller';
import { BuffTemplate } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([BuffTemplate])],
  controllers: [BuffController],
  providers: [BuffService],
  exports: [BuffService],
})
export class BuffModule {}
