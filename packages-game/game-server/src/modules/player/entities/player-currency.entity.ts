import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CurrencyType } from '@constants/enums';
import { Player } from './player.entity';

@Entity('player_currencies')
@Index(['playerId', 'currencyType'], { unique: true })
export class PlayerCurrency {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @ManyToOne(() => Player)
  @JoinColumn({ name: 'player_id' })
  player: Player;

  @Column({ name: 'currency_type', type: 'enum', enum: CurrencyType })
  currencyType: CurrencyType;

  @Column({ type: 'bigint', default: '0' })
  amount: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
