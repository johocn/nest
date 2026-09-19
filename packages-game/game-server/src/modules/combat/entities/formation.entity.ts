import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { FormationType } from '@constants/enums';

export interface FormationBaseBonus {
  attack: number;
  defense: number;
  heal: number;
}

@Entity('formations')
@Index('idx_formation_type', ['type'])
export class Formation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'enum', enum: FormationType })
  type: FormationType;

  @Column({ name: 'max_members', type: 'int' })
  maxMembers: number;

  @Column({ name: 'base_bonus', type: 'jsonb', default: '{}' })
  baseBonus: FormationBaseBonus;

  @Column({
    name: 'counter_type',
    type: 'enum',
    enum: FormationType,
    nullable: true,
  })
  counterType: FormationType | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
