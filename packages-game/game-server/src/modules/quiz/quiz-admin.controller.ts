import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QuizAdminService } from './quiz-admin.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** quiz 题库管理端（admin-web 路由前缀 api/admin/v1/quiz） */
@ApiTags('Admin-Quiz')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/quiz')
export class QuizAdminController {
  constructor(private readonly quizAdminService: QuizAdminService) {}

  private assertId(id: string): string {
    if (!/^\d+$/.test(id)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return id;
  }

  // ===== 题目池 =====

  @Get('question/list')
  @ApiOperation({ summary: '题目列表' })
  async listQuestions(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('kind') kind?: string,
    @Query('category') category?: string,
    @Query('appScope') appScope?: string,
  ) {
    return this.quizAdminService.listQuestions(
      Number(page),
      Number(limit),
      kind,
      category,
      appScope,
    );
  }

  @Get('question/:id')
  @ApiOperation({ summary: '题目详情' })
  async getQuestion(@Param('id') id: string) {
    return this.quizAdminService.getQuestion(this.assertId(id));
  }

  @Post('question')
  @ApiOperation({ summary: '创建题目' })
  async createQuestion(@Body() body: any) {
    return this.quizAdminService.createQuestion(body);
  }

  @Put('question/:id')
  @ApiOperation({ summary: '修改题目' })
  async updateQuestion(@Param('id') id: string, @Body() body: any) {
    return this.quizAdminService.updateQuestion(this.assertId(id), body);
  }

  @Delete('question/:id')
  @ApiOperation({ summary: '删除题目' })
  async deleteQuestion(@Param('id') id: string) {
    await this.quizAdminService.deleteQuestion(this.assertId(id));
    return { success: true };
  }

  // ===== 结果库 =====

  @Get('result/list')
  @ApiOperation({ summary: '结果列表' })
  async listResults(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('appScope') appScope?: string,
  ) {
    return this.quizAdminService.listResults(
      Number(page),
      Number(limit),
      appScope,
    );
  }

  @Get('result/:id')
  @ApiOperation({ summary: '结果详情' })
  async getResult(@Param('id') id: string) {
    return this.quizAdminService.getResult(this.assertId(id));
  }

  @Post('result')
  @ApiOperation({ summary: '创建结果' })
  async createResult(@Body() body: any) {
    return this.quizAdminService.createResult(body);
  }

  @Put('result/:id')
  @ApiOperation({ summary: '修改结果' })
  async updateResult(@Param('id') id: string, @Body() body: any) {
    return this.quizAdminService.updateResult(this.assertId(id), body);
  }

  @Delete('result/:id')
  @ApiOperation({ summary: '删除结果' })
  async deleteResult(@Param('id') id: string) {
    await this.quizAdminService.deleteResult(this.assertId(id));
    return { success: true };
  }

  // ===== 测评卷 =====

  @Get('assessment/list')
  @ApiOperation({ summary: '测评卷列表' })
  async listAssessments(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('appScope') appScope?: string,
  ) {
    return this.quizAdminService.listAssessments(
      Number(page),
      Number(limit),
      appScope,
    );
  }

  @Get('assessment/:id')
  @ApiOperation({ summary: '测评卷详情（items 按 sortOrder 排序 + 题目摘要）' })
  async getAssessment(@Param('id') id: string) {
    return this.quizAdminService.getAssessment(this.assertId(id));
  }

  @Post('assessment')
  @ApiOperation({ summary: '创建测评卷（保存前做流程连通性校验）' })
  async createAssessment(@Body() body: any) {
    return this.quizAdminService.createAssessment(body);
  }

  @Put('assessment/:id')
  @ApiOperation({ summary: '修改测评卷（items 全量替换）' })
  async updateAssessment(@Param('id') id: string, @Body() body: any) {
    return this.quizAdminService.updateAssessment(this.assertId(id), body);
  }

  @Delete('assessment/:id')
  @ApiOperation({ summary: '删除测评卷（软删）' })
  async deleteAssessment(@Param('id') id: string) {
    await this.quizAdminService.deleteAssessment(this.assertId(id));
    return { success: true };
  }

  @Post('assessment/:id/publish')
  @ApiOperation({ summary: '发布测评卷（发布前重跑流程校验）' })
  async publishAssessment(@Param('id') id: string) {
    return this.quizAdminService.publishAssessment(this.assertId(id));
  }
}
