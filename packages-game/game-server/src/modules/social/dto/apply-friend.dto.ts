import { IsString } from 'class-validator';

export class ApplyFriendDto {
  @IsString()
  friendId: string;
}
