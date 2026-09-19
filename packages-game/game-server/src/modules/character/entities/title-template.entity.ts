import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('title_templates')
export class TitleTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'icon_url', type: 'varchar', length: 256, nullable: true })
  iconUrl: string | null;

  @Column({ type: 'jsonb', default: {} })
  condition: any;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: any;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
