import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { RankingType } from '@constants/enums';

@Entity('ranking_records')
@Index('idx_ranking_type', ['rankingType'])
@Index('idx_ranking_player', ['playerId'])
export class RankingRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'ranking_type', type: 'enum', enum: RankingType })
  rankingType: RankingType;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'player_name', type: 'varchar', length: 64 })
  playerName: string;

  @Column({ name: 'rank_value', type: 'bigint' })
  rankValue: string;

  @Column({ name: 'rank_order', type: 'int' })
  rankOrder: number;

  @CreateDateColumn({ name: 'snapshot_at' })
  snapshotAt: Date;
}
