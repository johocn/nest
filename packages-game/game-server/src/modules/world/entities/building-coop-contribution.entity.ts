import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * 共建投料流水（S6）
 * 一行 = 一次投料；超时退款按流水逐条原路返还，refunded 标记保证幂等。
 */
@Entity('building_coop_contributions')
@Index('idx_coop_contribution_building', ['buildingInstanceId'])
export class BuildingCoopContribution {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'building_instance_id', type: 'bigint' })
  buildingInstanceId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'item_id', type: 'bigint', nullable: true })
  itemId: string | null;

  @Column({ name: 'currency_type', type: 'varchar', length: 32, nullable: true })
  currencyType: string | null;

  @Column({ name: 'amount', type: 'int' })
  amount: number;

  @Column({ name: 'refunded', type: 'boolean', default: false })
  refunded: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}