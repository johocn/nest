import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SandboxService } from './sandbox.service';
import type { MarketDataItem, GameState } from './sandbox.service';

@ApiTags('Sandbox')
@Controller('api/sandbox/v1')
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Get('market-data')
  @ApiOperation({ summary: '获取市场历史数据' })
  getMarketData(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 30,
  ): { items: MarketDataItem[]; total: number; page: number; pageSize: number } {
    return this.sandboxService.getMarketData(page, pageSize);
  }

  @Get('state')
  @ApiOperation({ summary: '获取当前游戏状态' })
  getState(): GameState {
    return this.sandboxService.getGameState();
  }

  @Post('advance')
  @ApiOperation({ summary: '推进一个切片' })
  advanceSlice(): GameState {
    return this.sandboxService.advanceSlice();
  }

  @Post('invest')
  @ApiOperation({ summary: '投资操作' })
  invest(
    @Body('type') type: string,
    @Body('amount') amount: number,
  ): { success: boolean; message: string; state: GameState } {
    return this.sandboxService.invest(type, amount);
  }

  @Post('reset')
  @ApiOperation({ summary: '重置游戏' })
  reset(): GameState {
    return this.sandboxService.reset();
  }
}