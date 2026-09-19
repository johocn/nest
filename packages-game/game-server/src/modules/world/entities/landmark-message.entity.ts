import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('landmark_messages')
export class LandmarkMessage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'object_id', type: 'bigint' })
  objectId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'varchar', length: 100 })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
