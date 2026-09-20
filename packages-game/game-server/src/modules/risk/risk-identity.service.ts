import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { RiskLinkType } from '@constants/enums';
import { AccountLoginLog } from '@modules/auth/entities/account-login-log.entity';
import { AuthAccount } from '@modules/auth/entities/auth-account.entity';
import { Player } from '@modules/player/entities/player.entity';
import { RiskIdentityLink } from './entities';

const WINDOW_DEFAULT_MIN = 10;
const CONFIDENCE: Record<RiskLinkType, number> = {
  [RiskLinkType.SAME_IP]: 0.7,
  [RiskLinkType.SAME_DEVICE]: 0.95,
  [RiskLinkType.SSO]: 0.85,
};

interface Edge {
  playerIdA: string;
  playerIdB: string;
  linkType: RiskLinkType;
  confidence: number;
  evidenceJson: Record<string, unknown>;
}

/**
 * 身份聚类识别（一人多号）：从登录日志/账号数据构造账号邻接图，
 * 强信号（同IP×窗口 / 同设备 / SSO同源）→「同人多号」身份分并入风控分。
 * 只读聚合，不改登录日志写入侧。邻接无向去重（a<b 字典序）、幂等 upsert。
 */
@Injectable()
export class RiskIdentityService {
  private readonly logger = new Logger(RiskIdentityService.name);

  constructor(
    @InjectRepository(RiskIdentityLink)
    private readonly linkRepo: Repository<RiskIdentityLink>,
    @InjectRepository(AccountLoginLog)
    private readonly loginLogRepo: Repository<AccountLoginLog>,
    @InjectRepository(AuthAccount)
    private readonly accountRepo: Repository<AuthAccount>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
  ) {}

  /**
   * 聚合登录日志（窗口内同 IP / 同 device / SSO 同源）构建身份邻接图。
   * 幂等：邻接去重（a<b），已存在关联不重复写行。
   */
  async buildGraph(opts: { windowMin?: number } = {}): Promise<{ links: number }> {
    const windowMin = opts.windowMin ?? WINDOW_DEFAULT_MIN;
    const since = new Date(Date.now() - windowMin * 60_000);
    const logs = await this.loginLogRepo.find({ where: { createdAt: MoreThan(since) } });
    const accounts = await this.accountRepo.find();

    const accountIds = new Set<string>([
      ...logs.map((l) => String(l.accountId)),
      ...accounts.filter((a) => a.ssoId).map((a) => String(a.id)),
    ]);
    const players = accountIds.size
      ? await this.playerRepo.find({ where: [...accountIds].map((id) => ({ accountId: id })) })
      : [];
    const playerByAccount = new Map<string, string>();
    for (const p of players) playerByAccount.set(String(p.accountId), String(p.id));

    const edges = new Map<string, Edge>();
    const track = (accA: string, accB: string, linkType: RiskLinkType, ip?: string, device?: string, ssoId?: string) => {
      const pa = playerByAccount.get(accA);
      const pb = playerByAccount.get(accB);
      if (!pa || !pb || pa === pb) return;
      const [a, b] = pa < pb ? [pa, pb] : [pb, pa];
      const key = `${a}|${b}|${linkType}`;
      const evidence: Record<string, unknown> = {};
      if (ip) evidence.ips = [ip];
      if (device) evidence.devices = [device];
      if (ssoId) evidence.ssoId = ssoId;
      const prev = edges.get(key);
      // 同类型重复信号累计置信度（取高）
      if (prev && prev.confidence >= CONFIDENCE[linkType]) return;
      edges.set(key, { playerIdA: a, playerIdB: b, linkType, confidence: CONFIDENCE[linkType], evidenceJson: evidence });
    };
    const pairIn = (
      group: Map<string, string[]>,
      linkType: RiskLinkType,
      pick: (k: string) => { ip?: string; device?: string; ssoId?: string },
    ) => {
      for (const [key, members] of group) {
        const uniq = [...new Set(members)];
        if (uniq.length < 2) continue;
        for (let i = 0; i < uniq.length; i++) {
          for (let j = i + 1; j < uniq.length; j++) {
            const e = pick(key);
            track(uniq[i], uniq[j], linkType, e.ip, e.device, e.ssoId);
          }
        }
      }
    };

    // 1) SAME_IP × 窗口
    const byIp = new Map<string, string[]>();
    for (const l of logs) {
      if (!l.loginIp) continue;
      const pid = String(l.accountId);
      if (!playerByAccount.has(pid)) continue;
      byIp.set(l.loginIp, [...(byIp.get(l.loginIp) ?? []), pid]);
    }
    pairIn(byIp, RiskLinkType.SAME_IP, (ip) => ({ ip }));

    // 2) SAME_DEVICE（登录日志设备指纹）
    const byDevice = new Map<string, string[]>();
    for (const l of logs) {
      if (!l.deviceInfo) continue;
      const pid = String(l.accountId);
      if (!playerByAccount.has(pid)) continue;
      byDevice.set(l.deviceInfo, [...(byDevice.get(l.deviceInfo) ?? []), pid]);
    }
    pairIn(byDevice, RiskLinkType.SAME_DEVICE, (d) => ({ device: d }));

    // 3) SSO 同源（账号绑定同一 sso）
    const bySso = new Map<string, string[]>();
    for (const a of accounts) {
      if (!a.ssoId) continue;
      const pid = String(a.id);
      if (!playerByAccount.has(pid)) continue;
      bySso.set(a.ssoId, [...(bySso.get(a.ssoId) ?? []), pid]);
    }
    pairIn(bySso, RiskLinkType.SSO, (sso) => ({ ssoId: sso }));

    // 幂等落库：已存在关联跳过
    const existingKeys = new Set(
      (await this.linkRepo.find()).map((e) => `${e.playerIdA}|${e.playerIdB}|${e.linkType}`),
    );
    let saved = 0;
    for (const edge of edges.values()) {
      const key = `${edge.playerIdA}|${edge.playerIdB}|${edge.linkType}`;
      if (existingKeys.has(key)) continue;
      await this.linkRepo.save(this.linkRepo.create(edge));
      existingKeys.add(key);
      saved++;
    }
    this.logger.log(`risk identity buildGraph window=${windowMin}m edges=${edges.size} new=${saved}`);
    return { links: edges.size };
  }
}