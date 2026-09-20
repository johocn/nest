import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity('player_explorations')
@Index(['playerId', 'sceneId'], { unique: true })
export class PlayerExploration {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'scene_id', type: 'varchar', length: 64 })
  sceneId: string;

  @Column({ name: 'times', type: 'int', default: 1 })
  times: number;

  @CreateDateColumn({ name: 'discovered_at' })
  discoveredAt: Date;
}