import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { Profession, Gender } from '@constants/enums';

@Entity('characters')
export class Character {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'player_id', type: 'bigint', nullable: true })
  playerId: string | null;

  @Column({ type: 'varchar', length: 20 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  nickname: string;

  @Column({ type: 'enum', enum: Profession })
  profession: Profession;

  @Column({ type: 'enum', enum: Gender })
  gender: Gender;

  @Column({ type: 'int' })
  age: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  birthday: string | null;

  @Column({ name: 'is_npc', type: 'boolean', default: false })
  isNpc: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
