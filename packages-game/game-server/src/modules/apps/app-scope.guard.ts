import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppsService } from './apps.service';

/** 可选 guard：仅挂到需要 appCode 的玩家侧 controller，解析结果写入 request.appCode */
@Injectable()
export class AppScopeGuard implements CanActivate {
  constructor(private readonly appsService: AppsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    request.appCode = await this.appsService.resolveAppCode(request.headers['x-api-key']);
    return true;
  }
}
