import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { RiskLinkType } from '@constants/enums';

/**
 * 身份聚类邻接（一人多号）：playerA < playerB 字典序存储（无向、去重）。
 * 强信号：同IP×窗口 / 同设备 / SSO同源。uk(playerIdA, playerIdB, linkType) 幂等。
 */
@Entity('risk_identity_links')
@Unique(['playerIdA', 'playerIdB', 'linkType'])
export class RiskIdentityLink {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'player_id_a', type: 'varchar', length: 64 })
  playerIdA: string;

  @Index()
  @Column({ name: 'player_id_b', type: 'varchar', length: 64 })
  playerIdB: string;

  @Column({ name: 'link_type', type: 'enum', enum: RiskLinkType })
  linkType: RiskLinkType;

  @Column({ name: 'confidence', type: 'double precision', default: 0 })
  confidence: number;

  @Column({ name: 'evidence_json', type: 'jsonb', default: '{}' })
  evidenceJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}