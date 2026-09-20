import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskIdentityLink } from './entities';

/**
 * 身份聚类识别（一人多号）：从登录日志/账号数据构造账号邻接图，
 * 强信号（同IP×窗口 / 同设备 / SSO同源）→「同人多号」身份分并入风控分。
 * 只读聚合，不改登录日志写入侧。
 */
@Injectable()
export class RiskIdentityService {
  constructor(
    @InjectRepository(RiskIdentityLink)
    private readonly linkRepo: Repository<RiskIdentityLink>,
  ) {}

  async buildGraph(): Promise<{ links: number }> {
    throw new NotImplementedException('RiskIdentityService.buildGraph 待实现');
  }
}