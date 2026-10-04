import {
  Body,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TraceService } from './trace.service';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Debug-Trace')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/debug/v1/traces')
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  @Get('recent')
  @ApiOperation({ summary: '取最近 N 条 trace（Admin 才能看，ring buffer 最多 200 条）' })
  async list(@Query('limit') limit = 20) {
    const records = this.traceService.listRecent(Number(limit));
    return {
      enabled: this.traceService.enabled,
      count: records.length,
      traces: records.map((t) => ({
        traceId: t.traceId,
        root: t.rootSpanId,
        totalSpans: t.spans.length,
        totalMs: Math.max(...t.spans.map((s) => s.startTime + s.duration - t.spans[0].startTime)) | 0,
        createdAt: new Date(t.createdAt).toISOString(),
        spans: t.spans.map((s) => s.toJSON()),
      })),
    };
  }

  @Get()
  @ApiOperation({ summary: '按 traceId 查单条 trace 详情' })
  async find(@Query('traceId') traceId: string) {
    const rec = this.traceService.find(traceId);
    if (!rec) return { found: false };
    return {
      found: true,
      traceId: rec.traceId,
      totalSpans: rec.spans.length,
      spans: rec.spans.map((s) => s.toJSON()),
    };
  }

  @Get('clear')
  @ApiOperation({ summary: '清空 ring buffer（调试用）' })
  async clear() {
    this.traceService.clear();
    return { cleared: true };
  }
}
