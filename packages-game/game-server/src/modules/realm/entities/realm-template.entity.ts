import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('realm_templates')
export class RealmTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index({ unique: true })
  @Column({ name: 'realm_level', type: 'int' })
  realmLevel: number;

  @Column({ name: 'realm_name', type: 'varchar', length: 50 })
  realmName: string;

  @Column({ name: 'required_value', type: 'bigint', default: '0' })
  requiredValue: string;

  @Column({ name: 'consume_items_json', type: 'jsonb', default: [] })
  consumeItemsJson: any;

  @Column({ name: 'stat_bonus_json', type: 'jsonb', default: {} })
  statBonusJson: any;

  @Column({ name: 'milestone_reward_json', type: 'jsonb', default: {} })
  milestoneRewardJson: any;
}