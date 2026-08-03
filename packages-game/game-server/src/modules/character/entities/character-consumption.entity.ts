import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';
import { HungerStatus } from '@constants/enums';

@Entity('character_consumptions')
export class CharacterConsumption {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ name: 'food_per_day', type: 'int', default: 9 })
  foodPerDay: number;

  @Column({ name: 'min_food', type: 'int', default: 3 })
  minFood: number;

  @Column({ name: 'last_consume_at', type: 'timestamp', nullable: true })
  lastConsumeAt: Date | null;

  @Column({ name: 'hunger_days', type: 'int', default: 0 })
  hungerDays: number;

  @Column({ type: 'enum', enum: HungerStatus, default: HungerStatus.NORMAL })
  status: HungerStatus;
}
