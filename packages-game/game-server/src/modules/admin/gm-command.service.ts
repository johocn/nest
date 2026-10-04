import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PlayerService } from '@modules/player/player.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { BuffService } from '@modules/buff/buff.service';
import { CharacterService } from '@modules/character/character.service';
import { ConnectionService } from '@modules/gateway/connection.service';

/** GM 命令执行上下文 */
export interface GmContext {
  adminId: string;
  targetPlayerId?: string;
  args: Record<string, any>;
}

/** GM 命令接口 —— 每个命令实现此接口 */
export interface GmCommand {
  /** 命令名，如 'player.give-exp' */
  name: string;
  /** 一句话描述（GET gm/list 返回给前端展示） */
  description: string;
  /** 参数定义（给前端参考用） */
  argsSchema: Record<string, { type: string; required?: boolean; description?: string }>;
  /** 执行命令，返回结构化结果 */
  execute(ctx: GmContext): Promise<Record<string, any>>;
}

/** GM 命令执行器 —— 注册表 + 分发 + 自动写 GmOperateLog */
@Injectable()
export class GmCommandService {
  private readonly logger = new Logger(GmCommandService.name);
  private readonly commands = new Map<string, GmCommand>();

  constructor(
    private readonly adminService: AdminService,
    private readonly playerService: PlayerService,
    private readonly inventoryService: InventoryService,
    private readonly buffService: BuffService,
    private readonly characterService: CharacterService,
    private readonly connectionService: ConnectionService,
  ) {
    this.registerBuiltins();
  }

  /** 注册一个命令（重复 name 会覆盖） */
  register(cmd: GmCommand): void {
    this.commands.set(cmd.name, cmd);
  }

  /** 列出所有可用命令 */
  list(): Array<{ name: string; description: string; argsSchema: any }> {
    return [...this.commands.values()].map((c) => ({
      name: c.name,
      description: c.description,
      argsSchema: c.argsSchema,
    }));
  }

  /**
   * 执行 GM 命令 + 自动写 GmOperateLog。
   * 命令抛错时不写日志（操作未发生），只返回 error。
   */
  async execute(ctx: GmContext): Promise<{
    ok: boolean;
    cmd: string;
    result?: Record<string, any>;
    error?: string;
    logId?: string;
  }> {
    const cmd = this.commands.get(ctx.args.cmd);
    if (!cmd) {
      return { ok: false, cmd: ctx.args.cmd, error: `未知 GM 命令: ${ctx.args.cmd}` };
    }

    try {
      const result = await cmd.execute(ctx);

      // 自动写 GM 操作日志（before/after 都从 result 取，命令返回什么就记什么）
      const log = await this.adminService.logOperation({
        adminId: ctx.adminId,
        targetPlayerId: ctx.targetPlayerId,
        operation: ctx.args.cmd,
        changeBefore: (result as any)?.__before ?? {},
        changeAfter: { ...result },
      });

      this.logger.log(`[GM] ${ctx.adminId} → ${ctx.args.cmd} OK ${ctx.targetPlayerId ?? ''}`);
      return { ok: true, cmd: ctx.args.cmd, result, logId: String(log.id) };
    } catch (err: any) {
      this.logger.error(`[GM] ${ctx.adminId} → ${ctx.args.cmd} FAIL: ${err?.message ?? err}`);
      return { ok: false, cmd: ctx.args.cmd, error: err?.message ?? String(err) };
    }
  }

  /** ============ 内置命令 ============ */
  private registerBuiltins(): void {
    this.register({
      name: 'player.give-exp',
      description: '给玩家加经验（自动触发升级事件）',
      argsSchema: {
        playerId: { type: 'string', required: true, description: '目标玩家 ID' },
        amount: { type: 'number', required: true, description: '经验数（正整数）' },
      },
      execute: async (ctx) => {
        const playerId = ctx.targetPlayerId ?? ctx.args.playerId;
        const amount = Number(ctx.args.amount);
        if (!playerId) throw new BadRequestException('缺少 playerId');
        if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount 必须 > 0');

        const res = await this.playerService.addExp(playerId, amount);
        return {
          __before: { exp: res.player.exp, level: res.player.level },
          leveledUp: res.leveledUp,
          newLevel: res.player.level,
          playerId,
          amount,
        };
      },
    });

    this.register({
      name: 'player.give-vip-exp',
      description: '给玩家加 VIP 经验',
      argsSchema: {
        playerId: { type: 'string', required: true },
        amount: { type: 'number', required: true },
      },
      execute: async (ctx) => {
        const playerId = ctx.targetPlayerId ?? ctx.args.playerId;
        const amount = Number(ctx.args.amount);
        if (!playerId) throw new BadRequestException('缺少 playerId');
        if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount 必须 > 0');

        const res = await this.playerService.addVipExp(playerId, amount);
        return {
          leveledUp: res.leveledUp,
          newVipLevel: res.vipLevel,
          newVipExp: res.vipExp,
          playerId,
          amount,
        };
      },
    });

    this.register({
      name: 'player.give-item',
      description: '给玩家发道具',
      argsSchema: {
        playerId: { type: 'string', required: true },
        itemTemplateId: { type: 'string', required: true },
        quantity: { type: 'number', required: true },
      },
      execute: async (ctx) => {
        const playerId = ctx.targetPlayerId ?? ctx.args.playerId;
        const itemTemplateId = String(ctx.args.itemTemplateId);
        const quantity = Number(ctx.args.quantity);
        if (!playerId) throw new BadRequestException('缺少 playerId');
        if (!itemTemplateId) throw new BadRequestException('缺少 itemTemplateId');
        if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('quantity 必须 > 0');

        const opTrace = `gm:${ctx.adminId}:give-item:${Date.now()}`;
        const item = await this.inventoryService.addItem(playerId, itemTemplateId, quantity, opTrace);
        return {
          itemId: item.id,
          itemTemplateId,
          quantity,
          bindStatus: item.bindStatus,
          playerId,
        };
      },
    });

    this.register({
      name: 'player.give-buff',
      description: '给玩家加 Buff',
      argsSchema: {
        playerId: { type: 'string', required: true },
        buffTemplateId: { type: 'string', required: true },
      },
      execute: async (ctx) => {
        const playerId = ctx.targetPlayerId ?? ctx.args.playerId;
        const buffTemplateId = String(ctx.args.buffTemplateId);
        if (!playerId) throw new BadRequestException('缺少 playerId');
        if (!buffTemplateId) throw new BadRequestException('缺少 buffTemplateId');

        // playerId → characterId（buff 系统按 character 维度挂）
        const character = await this.characterService.getByPlayerId(playerId);
        if (!character) throw new BadRequestException(`玩家 ${playerId} 无角色记录`);

        const res = await this.buffService.applyBuff(character.id, buffTemplateId);
        return {
          buffId: res.buff.id,
          buffName: res.buff.name,
          duration: res.buff.duration,
          characterId: character.id,
          playerId,
        };
      },
    });

    this.register({
      name: 'player.teleport',
      description: '切换玩家所在场景（character 维度，客户端下次 enter-scene 同步）',
      argsSchema: {
        playerId: { type: 'string', required: true },
        mapId: { type: 'string', required: true },
      },
      execute: async (ctx) => {
        const playerId = ctx.targetPlayerId ?? ctx.args.playerId;
        const mapId = String(ctx.args.mapId);
        if (!playerId) throw new BadRequestException('缺少 playerId');
        if (!mapId) throw new BadRequestException('缺少 mapId');

        const character = await this.characterService.getByPlayerId(playerId);
        if (!character) throw new BadRequestException(`玩家 ${playerId} 无角色记录`);

        const res = await this.characterService.updateLocation(character.id, { mapId });
        return {
          characterId: character.id,
          newMapId: res.mapId,
          landId: res.landId,
          playerId,
        };
      },
    });

    this.register({
      name: 'player.kick',
      description: '强制玩家下线（走正常 handleDisconnect 清理链路）',
      argsSchema: {
        playerId: { type: 'string', required: true },
        reason: { type: 'string', description: '踢人原因（可选）' },
      },
      execute: async (ctx) => {
        const playerId = ctx.targetPlayerId ?? ctx.args.playerId;
        if (!playerId) throw new BadRequestException('缺少 playerId');

        const conn = await this.connectionService.getPlayerConnection(playerId);
        if (!conn) {
          return { kicked: false, reason: '玩家当前不在线', playerId };
        }

        // 走正常断开链路 —— playerDisconnect 会清 Redis 连接追踪
        // Socket.IO 层面的 disconnect 由客户端收到服务器 down 帧后自己走 handleDisconnect
        await this.connectionService.playerDisconnect(playerId, `gm-kick:${ctx.args.reason ?? 'admin'}`);

        return {
          kicked: true,
          playerId,
          socketId: conn.socketId,
          reason: ctx.args.reason ?? 'admin',
        };
      },
    });
  }
}
