import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SanguoshaMode, SanguoshaTableStatus } from '@constants/enums';

/**
 * 三国杀牌桌持久化（8 人标准身份局）。
 * - 模块级隔离：独立表 sanguosha_rooms，与 guandan_rooms / sichuanmajiang 物理分表。
 * - 运营商级隔离：tenant_id 列，查询统一按运行期租户上下文过滤。
 * - 房间级隔离：state_json 为整局快照（断线重连直接恢复），events_json 为事件日志（回放）。
 */
@Entity('sanguosha_rooms')
export class SanguoshaRoom {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index({ unique: true })
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  /** 运营商/渠道租户 id（default=单租户兼容） */
  @Index()
  @Column({
    name: 'tenant_id',
    type: 'varchar',
    length: 64,
    default: 'default',
  })
  tenantId: string;

  @Column({
    name: 'mode',
    type: 'enum',
    enum: SanguoshaMode,
    default: SanguoshaMode.AI,
  })
  mode: SanguoshaMode;

  @Column({ name: 'host_player_id', type: 'varchar', length: 64 })
  hostPlayerId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: SanguoshaTableStatus,
    default: SanguoshaTableStatus.WAITING,
  })
  status: SanguoshaTableStatus;

  /** seat -> playerId（'bot-N' 表示 AI 座位，null 表示空位） */
  @Column({ name: 'players_json', type: 'jsonb' })
  playersJson: (string | null)[];

  /** seat -> 当前 socketId（断线为空，便于重连） */
  @Column({ name: 'sockets_json', type: 'jsonb', nullable: true })
  socketsJson: (string | null)[];

  /** 整局状态快照（SgsGameState），断线重连直接恢复 */
  @Column({ name: 'state_json', type: 'jsonb' })
  stateJson: any;

  /** 事件日志（驱动回放/审计） */
  @Column({ name: 'events_json', type: 'jsonb', nullable: true })
  eventsJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
