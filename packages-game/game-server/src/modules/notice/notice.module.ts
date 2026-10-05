import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoticeService } from './notice.service';
import { NoticeController } from './notice.controller';
import { NoticeAdminController } from './notice-admin.controller';
import { Notice, NoticeReaction } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([Notice, NoticeReaction])],
  controllers: [NoticeController, NoticeAdminController],
  providers: [NoticeService],
  exports: [NoticeService],
})
export class NoticeModule {}
