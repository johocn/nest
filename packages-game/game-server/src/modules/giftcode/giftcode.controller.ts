import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GiftCodeService } from './giftcode.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';

@ApiTags('GiftCode')
@Controller()
export class GiftCodeController {
  constructor(private readonly giftCodeService: GiftCodeService) {}

  // ===== Client: 玩家兑换 =====

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/giftcode/redeem')
  @ApiBearerAuth()
  @ApiOperation({ summary: '玩家兑换礼包码' })
  async redeem(
    @CurrentPlayer('playerId') playerId: string,
    @Body() body: { code: string },
  ) {
    return this.giftCodeService.redeem(playerId, body.code);
  }
}
