import { IsString } from 'class-validator';

export class StartNegotiationDto {
  @IsString()
  tradeOrderId: string;

  @IsString()
  askPrice: string;
}

export class ReplyNegotiationDto {
  @IsString()
  replyPrice: string;
}
