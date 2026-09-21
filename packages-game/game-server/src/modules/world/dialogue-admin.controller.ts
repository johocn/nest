import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Dialogue } from './entities/dialogue.entity';
import {
  CreateDialogueDto,
  DialogueQueryDto,
  UpdateDialogueDto,
} from './dto/dialogue.dto';
import { assertDialogueNodes, DialogueNode } from './dialogue/dialogue.types';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/**
 * 结构校验（风险 #3）：非法结构直接拒绝，错误信息带上问题 key 与原因。
 * 校验失败 → PARAM_INVALID（不落库）。
 */
function assertNodesOrThrow(nodes: unknown): DialogueNode[] {
  const asserted = assertDialogueNodes(nodes);
  if (!asserted.ok) {
    throw new GameException(
      ErrorCodes.PARAM_INVALID,
      `对话节点结构非法：${asserted.errors.join('；')}`,
    );
  }
  return asserted.nodes;
}

@ApiTags('Admin-World')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/world')
export class DialogueAdminController {
  constructor(
    @InjectRepository(Dialogue)
    private readonly dialogueRepo: Repository<Dialogue>,
    private readonly adminService: AdminService,
  ) {}

  // ---------- 对话树 CRUD ----------

  @Get('dialogue/list')
  @ApiOperation({ summary: '对话列表（分页 + 关键字）' })
  async listDialogues(@Query() query: DialogueQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const keyword = query.keyword?.trim();
    const where = keyword
      ? [{ code: ILike(`%${keyword}%`) }, { title: ILike(`%${keyword}%`) }]
      : {};
    const [items, total] = await this.dialogueRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { id: 'ASC' },
    });
    return { items, total, page, limit };
  }

  @Get('dialogue/:id')
  @ApiOperation({ summary: '对话详情' })
  async getDialogue(@Param('id') id: string) {
    const dialogue = await this.dialogueRepo.findOne({ where: { id } });
    if (!dialogue) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '对话不存在');
    }
    return dialogue;
  }

  @Post('dialogue')
  @ApiOperation({ summary: '新建对话树' })
  async createDialogue(
    @Body() dto: CreateDialogueDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const nodes = assertNodesOrThrow(dto.nodes);

    const existing = await this.dialogueRepo.findOne({
      where: { code: dto.code },
    });
    if (existing) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '对话编码已存在');
    }

    const dialogue = await this.dialogueRepo.save(
      this.dialogueRepo.create({
        code: dto.code,
        title: dto.title,
        nodes,
        version: dto.version ?? 1,
        isActive: dto.isActive ?? true,
      }),
    );
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'dialogue.create',
      changeBefore: {},
      changeAfter: {
        id: dialogue.id,
        code: dialogue.code,
        title: dialogue.title,
        version: dialogue.version,
        isActive: dialogue.isActive,
      },
    });
    return dialogue;
  }

  @Put('dialogue/:id')
  @ApiOperation({ summary: '更新对话树' })
  async updateDialogue(
    @Param('id') id: string,
    @Body() dto: UpdateDialogueDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const dialogue = await this.dialogueRepo.findOne({ where: { id } });
    if (!dialogue) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '对话不存在');
    }

    const before = {
      code: dialogue.code,
      title: dialogue.title,
      version: dialogue.version,
      isActive: dialogue.isActive,
    };

    if (dto.nodes !== undefined) {
      dialogue.nodes = assertNodesOrThrow(dto.nodes);
    }
    if (dto.code !== undefined && dto.code !== dialogue.code) {
      const dup = await this.dialogueRepo.findOne({
        where: { code: dto.code },
      });
      if (dup) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '对话编码已存在');
      }
      dialogue.code = dto.code;
    }
    if (dto.title !== undefined) dialogue.title = dto.title;
    if (dto.version !== undefined) dialogue.version = dto.version;
    if (dto.isActive !== undefined) dialogue.isActive = dto.isActive;

    const saved = await this.dialogueRepo.save(dialogue);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'dialogue.update',
      changeBefore: before,
      changeAfter: {
        code: saved.code,
        title: saved.title,
        version: saved.version,
        isActive: saved.isActive,
      },
    });
    return saved;
  }

  @Post('dialogue/:id/toggle')
  @ApiOperation({ summary: '启用/停用对话' })
  async toggleDialogue(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const dialogue = await this.dialogueRepo.findOne({ where: { id } });
    if (!dialogue) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '对话不存在');
    }
    const before = { isActive: dialogue.isActive };
    dialogue.isActive = !dialogue.isActive;

    const saved = await this.dialogueRepo.save(dialogue);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'dialogue.toggle',
      changeBefore: before,
      changeAfter: { id: saved.id, code: saved.code, isActive: saved.isActive },
    });
    return saved;
  }
}