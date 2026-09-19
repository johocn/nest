import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('formation_bindings')
@Unique('uq_formation_player', ['formationId', 'playerId'])
@Index('idx_formation_leader', ['leaderId'])
export class FormationBinding {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'formation_id', type: 'bigint' })
  formationId: string;

  @Column({ name: 'leader_id', type: 'bigint' })
  leaderId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'int' })
  position: number;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;
}
