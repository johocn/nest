import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('chat_sign_ins')
@Index('idx_chat_signin_player_date', ['playerId', 'signInDate'], {
  unique: true,
})
export class ChatSignIn {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'sign_in_date', type: 'date' })
  signInDate: string;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
