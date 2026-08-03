import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CharacterService } from './character.service';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Character')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/character')
export class CharacterAdminController {
  constructor(private readonly characterService: CharacterService) {}

  @Get(':id/profile')
  @ApiOperation({ summary: '获取角色完整档案（管理端）' })
  async getProfile(@Param('id') id: string) {
    return this.characterService.getFullProfile(id);
  }

  @Get(':id/detail')
  @ApiOperation({ summary: '获取角色基础信息（管理端）' })
  async getDetail(@Param('id') id: string) {
    return this.characterService.getById(id);
  }
}
