import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminSessionService } from './admin-session.service';
import { AdminUser } from './entities/admin-user.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AdminUser])],
  providers: [AdminSessionService],
  exports: [AdminSessionService],
})
export class AdminSessionModule {}