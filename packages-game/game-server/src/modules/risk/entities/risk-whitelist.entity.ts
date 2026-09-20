import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('risk_whitelists')
export class RiskWhitelist {
  @PrimaryColumn({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'note', type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}