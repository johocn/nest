import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('encounter_templates')
export class EncounterTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'varchar', length: 64, nullable: true })
  sceneId: string | null;

  @Column({ name: 'title', type: 'varchar', length: 100 })
  title: string;

  @Column({ name: 'desc_text', type: 'varchar', length: 500, default: '' })
  descText: string;

  @Column({ name: 'trigger_rate', type: 'double precision', default: 0.1 })
  triggerRate: number;

  @Column({ name: 'cd_seconds', type: 'int', default: 300 })
  cdSeconds: number;

  @Column({ name: 'choices_json', type: 'jsonb', default: '[]' })
  choicesJson: any;

  @Column({ name: 'is_one_time', type: 'boolean', default: false })
  isOneTime: boolean;

  @Column({ name: 'reward_json', type: 'jsonb', default: '{}' })
  rewardJson: any;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}