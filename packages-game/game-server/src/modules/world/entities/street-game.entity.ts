import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { GameType } from '@constants/enums';

@Entity('street_games')
export class StreetGame {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'game_type', type: 'enum', enum: GameType })
  gameType: GameType;

  @Column({ name: 'min_level', type: 'int', default: 1 })
  minLevel: number;

  @Column({ name: 'bet_range', type: 'jsonb', default: { min: 10, max: 1000 } })
  betRange: any;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
