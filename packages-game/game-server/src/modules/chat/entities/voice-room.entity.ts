import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { VoiceRoomType } from '@constants/enums';

@Entity('voice_rooms')
export class VoiceRoom {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'room_name', type: 'varchar', length: 64 })
  roomName: string;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId: string;

  @Column({ name: 'room_type', type: 'enum', enum: VoiceRoomType })
  roomType: VoiceRoomType;

  @Column({ type: 'jsonb', default: '[]' })
  members: string[];

  @Column({ name: 'max_members', type: 'int', default: 8 })
  maxMembers: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
