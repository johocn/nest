# P0-B 账号安全（登录管理收口）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 GM token 永不过期（P0-5），并为 GM 与玩家补齐登出、改密、踢下线能力（P0-6），使凭证可过期、可主动失效。

**Architecture:** 复用 `AuthAccount.tokenVersion` 已有的会话版本机制（每次登录 +1、`validateToken` 比对），为 `AdminUser` 补同样的 `token_version` 列并抽出全局 `AdminSessionService` 供 `AdminGuard` 查库校验；GM 侧签发 token 时补 `expiresIn`。所有失效动作统一为「tokenVersion +1」，不引入 jti / 黑名单 / refresh token。

**Tech Stack:** NestJS 11 + TypeScript、TypeORM + PostgreSQL、`@nestjs/jwt`、class-validator、Jest 30 + ts-jest。

---

## 设计

### 缺陷根因

| 缺陷 | 根因 | 证据 |
|---|---|---|
| P0-5 GM token 无过期 | 签发时只传 `secret`，未传 `expiresIn`，payload 无 `exp` | [admin-auth.service.ts:57-59](file:///e:/code/nest/packages-game/game-server/src/modules/auth/admin-auth.service.ts#L57-L59) |
| P0-6 GM 无失效手段 | `AdminGuard` 只验签名与 `type`，不查库、不校验状态 | [admin.guard.ts:40-46](file:///e:/code/nest/packages-game/game-server/src/common/guards/admin.guard.ts#L40-L46) |
| P0-6 GM 无版本位 | `AdminUser` 实体无 `token_version` 列 | [admin-user.entity.ts](file:///e:/code/nest/packages-game/game-server/src/modules/auth/entities/admin-user.entity.ts) |
| P0-6 玩家无登出/改密 | `AuthService` 无 `logout` / `changePassword`，控制器无对应路由 | [auth.service.ts](file:///e:/code/nest/packages-game/game-server/src/modules/auth/auth.service.ts)、[auth.controller.ts](file:///e:/code/nest/packages-game/game-server/src/modules/auth/auth.controller.ts) |

### 关键设计决策

1. **失效机制统一为 tokenVersion +1**。玩家侧每次登录已 `tokenVersion + 1`（单端登录语义），本计划沿用同一语义实现登出/踢下线/改密，不新增 jti、黑名单或 refresh token。
2. **GM token 固定 12h，无续期**。配置项 `JWT_ADMIN_EXPIRES_IN` 默认 `12h`；GM 后台前端已有 `res.status === 401 → logout()` 兜底（[index.html:462](file:///e:/code/nest/packages-game/game-server/admin/index.html#L462)），无需前端改造。
3. **新增 `AdminSessionModule`（`@Global`）承载 GM 会话校验**。`AdminGuard` 被 30+ 模块以 `@UseGuards(AdminGuard)` 类引用，其依赖必须在各模块上下文可解析，而 `AdminUser` 仓库只在 `AuthModule` 内注册过（且仅 `risk`/`gateway`/`community`/`chat` 4 个模块 import 了 `AuthModule`）。故把「GM 会话状态」抽为全局模块。
4. **`AdminSessionService` 只依赖窄接口，不依赖 `AdminJwtPayload`**。它声明 `AdminSessionClaims { adminId; tokenVersion }`，只描述自己真正校验的字段。这样 Task 1 可独立编译通过，且 `admin.guard.ts → admin-session.service.ts` 为单向依赖，不产生循环 import。
5. **`AdminJwtPayload` 新增必填 `tokenVersion`**。存量 GM token 无该字段 → 与 DB 默认值 `0` 不等 → 校验失败。这是**预期行为**：上线后 GM 需重新登录一次（详见「风险与回滚」）。
6. **`AuthService.logout` 内做数字校验**。`accountId` 来自 URL 路径，非数字会触发 bigint 列的 `QueryFailedError → 500`；统一在 service 层用 `/^\d+$/` 前置拦截，两个调用方（玩家登出、GM 踢下线）都受保护。GM 侧 `adminId` 来自已验签 JWT 且已被 `AdminSessionService` 校验过，不重复校验。
7. **SSO 账号拒绝改密**。SSO 账号的 `passwordHash` 是随机 UUID 哈希，玩家无法提供原密码，直接给出明确提示而非「原密码错误」。新增错误码 `PASSWORD_CHANGE_NOT_ALLOWED: 10014`（`10001-10999` 账号登录段内，`10014` 未被占用）。
8. **GM 踢下线不做审计事件**。`account_security_events` 表的字段语义（`login_ip`/`device_info`）不适配管理动作，强行复用会污染数据；管理动作审计归 P0-8 GM 后台面板统一处理。
9. **不做的**：多端会话列表、GM 后面前端面板、refresh token、管理动作审计。

### 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/modules/auth/entities/admin-user.entity.ts` | GM 账号实体，新增 `tokenVersion` | 改 |
| `src/modules/auth/admin-session.service.ts` | GM 会话有效性校验（存在 / 启用 / 版本一致 / id 数字），只依赖窄接口 `AdminSessionClaims` | 建 |
| `src/modules/auth/admin-session.module.ts` | `@Global` 模块，向全局暴露 `AdminSessionService` | 建 |
| `src/app.module.ts` | 注册 `AdminSessionModule` | 改 |
| `src/common/guards/admin.guard.ts` | 验签后增加会话校验；payload 加 `tokenVersion` | 改 |
| `src/config/jwt.config.ts` | 新增 `adminExpiresIn` | 改 |
| `src/modules/auth/admin-auth.service.ts` | 签发带 `exp`；新增 `logout` / `changePassword` | 改 |
| `src/modules/auth/admin-auth.controller.ts` | 新增 GM 登出、GM 改密路由 | 改 |
| `src/modules/auth/dto/admin-password.dto.ts` | GM 改密入参 | 建 |
| `src/modules/auth/auth.service.ts` | 新增 `logout` / `changePassword` | 改 |
| `src/modules/auth/auth.controller.ts` | 新增玩家登出、玩家改密路由 | 改 |
| `src/modules/auth/dto/password.dto.ts` | 玩家改密入参 | 建 |
| `src/modules/auth/auth-admin.controller.ts` | 新增 GM 踢玩家下线路由 | 改 |
| `src/constants/error-codes.ts` | 新增 `PASSWORD_CHANGE_NOT_ALLOWED` | 改 |
| `scripts/smoke-p0b-auth.sh` | 线上冒烟脚本 | 建 |

### 测试基线

改动前：77 suites / 915 tests 全绿。本计划的单测命令统一在 `e:\code\nest\packages-game\game-server` 下执行：

```bash
npm test -- <文件或关键字>
```

---

## Task 1: AdminUser 会话版本列 + AdminSessionService 全局模块

**Files:**
- Modify: `packages-game/game-server/src/modules/auth/entities/admin-user.entity.ts`
- Create: `packages-game/game-server/src/modules/auth/admin-session.service.ts`
- Create: `packages-game/game-server/src/modules/auth/admin-session.module.ts`
- Test: `packages-game/game-server/src/modules/auth/admin-session.service.spec.ts`
- Modify: `packages-game/game-server/src/app.module.ts:8-9,62`

- [ ] **Step 1: 写失败的测试**

创建 `packages-game/game-server/src/modules/auth/admin-session.service.spec.ts`：

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminSessionService } from './admin-session.service';
import { AdminUser } from './entities/admin-user.entity';
import { AdminRole } from '@constants/enums';

const mockAdminRepo = {
  findOne: jest.fn(),
};

describe('AdminSessionService', () => {
  let service: AdminSessionService;

  const basePayload = {
    adminId: '1',
    username: 'admin',
    role: AdminRole.SUPER_ADMIN,
    type: 'admin' as const,
    tokenVersion: 0,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminSessionService,
        { provide: getRepositoryToken(AdminUser), useValue: mockAdminRepo },
      ],
    }).compile();
    service = moduleRef.get<AdminSessionService>(AdminSessionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return true when admin is active and tokenVersion matches', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      isActive: true,
      tokenVersion: 0,
    });

    await expect(service.validate(basePayload)).resolves.toBe(true);
    expect(mockAdminRepo.findOne).toHaveBeenCalledWith({
      where: { id: '1' },
    });
  });

  it('should return false when admin not found', async () => {
    mockAdminRepo.findOne.mockResolvedValue(null);
    await expect(service.validate(basePayload)).resolves.toBe(false);
  });

  it('should return false when admin is disabled', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      isActive: false,
      tokenVersion: 0,
    });
    await expect(service.validate(basePayload)).resolves.toBe(false);
  });

  it('should return false when tokenVersion mismatches', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      isActive: true,
      tokenVersion: 3,
    });
    await expect(service.validate(basePayload)).resolves.toBe(false);
  });

  it('should return false and skip query when adminId is not numeric', async () => {
    await expect(
      service.validate({ ...basePayload, adminId: 'not-a-number' }),
    ).resolves.toBe(false);
    expect(mockAdminRepo.findOne).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- admin-session.service.spec
```

Expected: FAIL，报 `Cannot find module './admin-session.service'`。

- [ ] **Step 3: 给 AdminUser 加 tokenVersion 列**

编辑 `packages-game/game-server/src/modules/auth/entities/admin-user.entity.ts`，在 `lastLoginAt` 之前插入：

```ts
  @Column({ name: 'token_version', type: 'int', default: 0 })
  tokenVersion: number;
```

- [ ] **Step 4: 实现 AdminSessionService**

创建 `packages-game/game-server/src/modules/auth/admin-session.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from './entities/admin-user.entity';

export interface AdminSessionClaims {
  adminId: string;
  tokenVersion: number;
}

@Injectable()
export class AdminSessionService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminRepo: Repository<AdminUser>,
  ) {}

  async validate(claims: AdminSessionClaims): Promise<boolean> {
    if (!/^\d+$/.test(claims.adminId)) return false;
    const admin = await this.adminRepo.findOne({
      where: { id: claims.adminId },
    });
    if (!admin) return false;
    if (!admin.isActive) return false;
    if (admin.tokenVersion !== claims.tokenVersion) return false;
    return true;
  }
}
```

注意：`validate` 的入参是窄接口 `AdminSessionClaims`，只声明自己校验的两个字段。`AdminJwtPayload`（Task 2 才补 `tokenVersion`）结构上满足它，因此本 Task 可独立编译通过，且不产生与 `admin.guard.ts` 的循环依赖。

- [ ] **Step 5: 实现 AdminSessionModule**

创建 `packages-game/game-server/src/modules/auth/admin-session.module.ts`：

```ts
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminSessionService } from './admin-session.service';
import { AdminUser } from './entities/admin-user.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AdminUser])],
  providers: [AdminSessionService],
  exports: [AdminSessionService],
})
export class AdminSessionModule {}
```

- [ ] **Step 6: 在 AppModule 注册**

编辑 `packages-game/game-server/src/app.module.ts`：

import 区（`AuthModule` 之后）加一行：

```ts
import { AdminSessionModule } from '@modules/auth/admin-session.module';
```

`imports` 数组的「第二层：基础设施」中，`EventListenersModule,` 之后加一行：

```ts
    AdminSessionModule,
```

- [ ] **Step 7: 跑测试与编译校验**

```bash
npm test -- admin-session.service.spec
npx tsc --noEmit
```

Expected: 测试 PASS（5 个用例 + 1 个 `should be defined`）；`tsc` 0 error（此时 `AdminJwtPayload` 尚未带 `tokenVersion`，因 `AdminSessionService` 只依赖窄接口，不会报错）。

- [ ] **Step 8: 提交**

```bash
git add packages-game/game-server/src/modules/auth/entities/admin-user.entity.ts packages-game/game-server/src/modules/auth/admin-session.service.ts packages-game/game-server/src/modules/auth/admin-session.module.ts packages-game/game-server/src/modules/auth/admin-session.service.spec.ts packages-game/game-server/src/app.module.ts
git commit -m "feat(auth): P0-B T1 GM 会话版本列与全局会话服务"
```

---

## Task 2: AdminGuard 接入会话校验

**Files:**
- Modify: `packages-game/game-server/src/common/guards/admin.guard.ts`
- Modify: `packages-game/game-server/src/modules/auth/admin-auth.service.ts:51-56`
- Test: `packages-game/game-server/src/common/guards/admin.guard.spec.ts`

- [ ] **Step 1: 写失败的测试**

创建 `packages-game/game-server/src/common/guards/admin.guard.spec.ts`：

```ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AdminGuard } from './admin.guard';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminRole } from '@constants/enums';

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let jwtService: { verify: jest.Mock };
  let sessionService: { validate: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };

  const payload = {
    adminId: '1',
    username: 'admin',
    role: AdminRole.SUPER_ADMIN,
    type: 'admin' as const,
    tokenVersion: 0,
  };

  function buildContext(authHeader?: string): ExecutionContext {
    const request: Record<string, any> = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    sessionService = { validate: jest.fn().mockResolvedValue(true) };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(null) };
    const configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    };
    guard = new AdminGuard(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      reflector as unknown as Reflector,
      sessionService as unknown as AdminSessionService,
    );
  });

  it('should throw when authorization header is missing', async () => {
    await expect(guard.canActivate(buildContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw when token is invalid', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    await expect(
      guard.canActivate(buildContext('Bearer bad')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw when token type is not admin', async () => {
    jwtService.verify.mockReturnValue({ ...payload, type: 'player' });
    await expect(
      guard.canActivate(buildContext('Bearer t')),
    ).rejects.toThrow(UnauthorizedException);
    expect(sessionService.validate).not.toHaveBeenCalled();
  });

  it('should throw when session is revoked', async () => {
    jwtService.verify.mockReturnValue(payload);
    sessionService.validate.mockResolvedValue(false);
    await expect(
      guard.canActivate(buildContext('Bearer t')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should pass and attach payload to request when session is valid', async () => {
    jwtService.verify.mockReturnValue(payload);
    const context = buildContext('Bearer t');
    const request = context.switchToHttp().getRequest();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessionService.validate).toHaveBeenCalledWith(payload);
    expect(request.user).toEqual(payload);
  });

  it('should throw when required role is missing', async () => {
    jwtService.verify.mockReturnValue(payload);
    reflector.getAllAndOverride.mockReturnValue(['operator']);
    await expect(
      guard.canActivate(buildContext('Bearer t')),
    ).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- admin.guard.spec
```

Expected: FAIL —— `AdminGuard` 构造函数只接受 3 个参数，第 4 个被忽略；`should throw when session is revoked` 与 `should pass ...` 会因未调用 `sessionService.validate` 而失败。

- [ ] **Step 3: 改 AdminGuard**

编辑 `packages-game/game-server/src/common/guards/admin.guard.ts`，三处改动：

（1）顶部 import 区追加：

```ts
import { AdminSessionService } from '@modules/auth/admin-session.service';
```

（2）`AdminJwtPayload` 接口追加字段：

```ts
export interface AdminJwtPayload {
  adminId: string;
  username: string;
  role: string;
  type: 'admin';
  tokenVersion: number;
}
```

（3）构造函数追加参数、`canActivate` 改为 async，并在 `type` 校验之后插入会话校验：

```ts
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly adminSessionService: AdminSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
```

在原来的

```ts
      if (payload.type !== 'admin') {
        throw new UnauthorizedException('Invalid admin token');
      }
```

之后、`const requiredRoles = ...` 之前插入：

```ts
      const sessionValid = await this.adminSessionService.validate(payload);
      if (!sessionValid) {
        throw new UnauthorizedException('Admin session revoked');
      }
```

- [ ] **Step 4: 补 admin-auth.service 的 payload 字段**

编辑 `packages-game/game-server/src/modules/auth/admin-auth.service.ts`，把 `login` 中的 payload 构造改为：

```ts
    const payload: AdminJwtPayload = {
      adminId: admin.id,
      username: admin.username,
      role: admin.role,
      type: 'admin',
      tokenVersion: admin.tokenVersion,
    };
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npm test -- admin.guard.spec
```

Expected: PASS，6 个用例。

- [ ] **Step 6: 全量编译校验**

```bash
npx tsc --noEmit
```

Expected: 0 error。若其他文件因 `AdminJwtPayload` 缺少 `tokenVersion` 报错，说明该处自行构造了 payload（本计划范围内不应出现，仅 `admin-auth.service.ts` 构造）。

> **执行偏离（实测补充）**：`AdminGuard` 增加第 4 个依赖后，`Test.createTestingModule` 无法解析该依赖（`@Global` 不渗透进测试模块），导致 3 个既有 admin controller spec 共 **15 个预存用例**失败：
> ```
> Nest can't resolve dependencies of the AdminGuard (JwtService, ConfigService, Reflector, ?).
> Please make sure that the argument AdminSessionService at index [3] is available in the RootTestModule module.
> ```
> 失败 suite：`risk-admin.controller.spec.ts`（10 例）、`reconcile-admin.controller.spec.ts`（3 例）、`economy-admin.controller.spec.ts`（2 例）。
>
> **Step 6.5: 为 3 个既有 controller spec 补 guard 依赖**
>
> 这 3 个 spec 的既有写法都是「显式提供 AdminGuard 的依赖」（手写 `JwtService` / `ConfigService` / `Reflector`），故沿用一致修法：各加 1 个 import + 1 个 mock provider：
>
> ```ts
> import { AdminSessionService } from '@modules/auth/admin-session.service';
> // ...
> {
>   provide: AdminSessionService,
>   useValue: { validate: jest.fn().mockResolvedValue(true) },
> },
> ```
>
> 改完跑全量回归应回到全绿（80 suites / 939 tests），`npx tsc --noEmit` = 0 error。

- [ ] **Step 7: 提交**

```bash
git add packages-game/game-server/src/common/guards/admin.guard.ts packages-game/game-server/src/common/guards/admin.guard.spec.ts packages-game/game-server/src/modules/auth/admin-auth.service.ts
git commit -m "feat(auth): P0-B T2 AdminGuard 增加会话版本与状态校验"
```

---

## Task 3: GM token 加入过期时间

**Files:**
- Modify: `packages-game/game-server/src/config/jwt.config.ts`
- Modify: `packages-game/game-server/src/modules/auth/admin-auth.service.ts:21-31,57-59`
- Test: `packages-game/game-server/src/modules/auth/admin-auth.service.spec.ts`
- Modify: `packages-game/game-server/.env.example`

- [ ] **Step 1: 写失败的测试**

编辑 `packages-game/game-server/src/modules/auth/admin-auth.service.spec.ts`：

（1）`mockConfigService` 改为同时返回 `adminExpiresIn`：

```ts
  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'jwt')
        return {
          secret: 'test-secret',
          expiresIn: '7d',
          adminExpiresIn: '12h',
        };
      return undefined;
    }),
  };
```

（2）把 `should login successfully` 用例改为同时断言签发参数：

```ts
  it('should login successfully', async () => {
    const mockAdmin = {
      id: '1',
      username: 'admin',
      passwordHash: '$2b$10$mockhash',
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
      tokenVersion: 0,
    };
    mockAdminRepo.findOne.mockResolvedValue(mockAdmin);
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);

    const result = await service.login('admin', 'password');
    expect(result.token).toBe('admin-jwt-token');
    expect(result.adminId).toBe('1');
    expect(result.role).toBe(AdminRole.SUPER_ADMIN);
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      {
        adminId: '1',
        username: 'admin',
        role: AdminRole.SUPER_ADMIN,
        type: 'admin',
        tokenVersion: 0,
      },
      { secret: 'test-secret', expiresIn: '12h' },
    );
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- admin-auth.service.spec
```

Expected: FAIL —— `sign` 实际收到 `{ secret: 'test-secret' }`，缺 `expiresIn`；且现构造函数用 `configService.get('jwt.secret')` 取值，mock 已改为只认 `'jwt'` 键，`jwtSecret` 会退回 `'default-secret'`。

- [ ] **Step 3: 扩展 jwt.config.ts**

编辑 `packages-game/game-server/src/config/jwt.config.ts` 全文替换为：

```ts
import { registerAs } from '@nestjs/config';

export interface JwtConfig {
  secret: string;
  expiresIn: string;
  adminExpiresIn: string;
}

export default registerAs(
  'jwt',
  (): JwtConfig => ({
    secret: process.env.JWT_SECRET || 'default-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    adminExpiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '12h',
  }),
);
```

- [ ] **Step 4: 改 admin-auth.service 取值与签发**

编辑 `packages-game/game-server/src/modules/auth/admin-auth.service.ts`：

（1）字段区追加：

```ts
  private readonly jwtSecret: string;
  private readonly jwtAdminExpiresIn: string;
```

（2）构造函数替换为：

```ts
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminRepo: Repository<AdminUser>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const jwtConfig = this.configService.get('jwt');
    this.jwtSecret = jwtConfig?.secret ?? 'default-secret';
    this.jwtAdminExpiresIn = jwtConfig?.adminExpiresIn ?? '12h';
  }
```

（3）签发处补 `expiresIn`：

```ts
    const token = this.jwtService.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: this.jwtAdminExpiresIn,
    } as JwtSignOptions);
```

- [ ] **Step 5: 补 .env.example**

编辑 `packages-game/game-server/.env.example`，在 `JWT_EXPIRES_IN` 所在行之后追加一行（保持文件原有风格）：

```
JWT_ADMIN_EXPIRES_IN=12h
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npm test -- admin-auth.service.spec
```

Expected: PASS，4 个用例。

- [ ] **Step 7: 提交**

```bash
git add packages-game/game-server/src/config/jwt.config.ts packages-game/game-server/src/modules/auth/admin-auth.service.ts packages-game/game-server/src/modules/auth/admin-auth.service.spec.ts packages-game/game-server/.env.example
git commit -m "feat(auth): P0-B T3 GM token 增加 12h 过期时间"
```

---

## Task 4: GM 登出 + GM 改密

**Files:**
- Create: `packages-game/game-server/src/modules/auth/dto/admin-password.dto.ts`
- Modify: `packages-game/game-server/src/modules/auth/admin-auth.service.ts`
- Modify: `packages-game/game-server/src/modules/auth/admin-auth.controller.ts`
- Test: `packages-game/game-server/src/modules/auth/admin-auth.service.spec.ts`

- [ ] **Step 1: 写失败的测试**

在 `packages-game/game-server/src/modules/auth/admin-auth.service.spec.ts` 末尾（`describe` 内）追加：

```ts
  it('should bump tokenVersion on logout', async () => {
    mockAdminRepo.findOne.mockResolvedValue({ id: '1', tokenVersion: 4 });

    await expect(service.logout('1')).resolves.toEqual({ ok: true });
    expect(mockAdminRepo.update).toHaveBeenCalledWith(
      { id: '1' },
      { tokenVersion: 5 },
    );
  });

  it('should throw on logout when admin not found', async () => {
    mockAdminRepo.findOne.mockResolvedValue(null);
    await expect(service.logout('9')).rejects.toThrow(GameException);
  });

  it('should throw when old password is wrong on changePassword', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      passwordHash: 'hash',
      tokenVersion: 0,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(false);

    await expect(
      service.changePassword('1', 'wrong', 'newpass123'),
    ).rejects.toThrow(GameException);
    expect(mockAdminRepo.update).not.toHaveBeenCalled();
  });

  it('should update password hash and bump tokenVersion on changePassword', async () => {
    mockAdminRepo.findOne.mockResolvedValue({
      id: '1',
      passwordHash: 'hash',
      tokenVersion: 2,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);

    await expect(
      service.changePassword('1', 'oldpass123', 'newpass123'),
    ).resolves.toEqual({ ok: true });

    expect(mockAdminRepo.update).toHaveBeenCalledTimes(1);
    const [criteria, patch] = mockAdminRepo.update.mock.calls[0];
    expect(criteria).toEqual({ id: '1' });
    expect(patch.tokenVersion).toBe(3);
    expect(typeof patch.passwordHash).toBe('string');
    expect(patch.passwordHash).not.toBe('hash');
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- admin-auth.service.spec
```

Expected: FAIL —— `service.logout is not a function`。

- [ ] **Step 3: 实现两个方法**

编辑 `packages-game/game-server/src/modules/auth/admin-auth.service.ts`，在 `comparePassword` 之前插入：

```ts
  async logout(adminId: string): Promise<{ ok: true }> {
    const admin = await this.adminRepo.findOne({ where: { id: adminId } });
    if (!admin) {
      throw new GameException(ErrorCodes.ADMIN_NOT_FOUND, '管理员不存在');
    }
    await this.adminRepo.update(
      { id: admin.id },
      { tokenVersion: admin.tokenVersion + 1 },
    );
    return { ok: true };
  }

  async changePassword(
    adminId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const admin = await this.adminRepo.findOne({ where: { id: adminId } });
    if (!admin) {
      throw new GameException(ErrorCodes.ADMIN_NOT_FOUND, '管理员不存在');
    }
    const isOldValid = await this.comparePassword(
      oldPassword,
      admin.passwordHash,
    );
    if (!isOldValid) {
      throw new GameException(ErrorCodes.ADMIN_PASSWORD_WRONG, '原密码错误');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.adminRepo.update(
      { id: admin.id },
      { passwordHash, tokenVersion: admin.tokenVersion + 1 },
    );
    return { ok: true };
  }
```

说明：`logout` / `changePassword` 均使当前 token 立即失效（`tokenVersion + 1`），改密后需用新密码重新登录。

- [ ] **Step 4: 创建 DTO**

创建 `packages-game/game-server/src/modules/auth/dto/admin-password.dto.ts`：

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  oldPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword: string;
}
```

- [ ] **Step 5: 加控制器路由**

编辑 `packages-game/game-server/src/modules/auth/admin-auth.controller.ts`：

（1）import 区替换为：

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminChangePasswordDto } from './dto/admin-password.dto';
import { Public } from '@common/decorators/public.decorator';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
```

（2）在类内 `login` 方法之后追加：

```ts
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'GM登出（当前 token 立即失效）' })
  async logout(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.adminAuthService.logout(admin.adminId);
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @Post('password')
  @ApiOperation({ summary: 'GM修改密码（改后需重新登录）' })
  async changePassword(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body() dto: AdminChangePasswordDto,
  ) {
    return this.adminAuthService.changePassword(
      admin.adminId,
      dto.oldPassword,
      dto.newPassword,
    );
  }
```

路由结果为 `POST /api/admin/v1/logout`、`POST /api/admin/v1/password`。

- [ ] **Step 6: 跑测试确认通过**

```bash
npm test -- admin-auth.service.spec
```

Expected: PASS，8 个用例。

- [ ] **Step 7: 提交**

```bash
git add packages-game/game-server/src/modules/auth/dto/admin-password.dto.ts packages-game/game-server/src/modules/auth/admin-auth.service.ts packages-game/game-server/src/modules/auth/admin-auth.service.spec.ts packages-game/game-server/src/modules/auth/admin-auth.controller.ts
git commit -m "feat(auth): P0-B T4 GM 登出与改密接口"
```

---

## Task 5: 玩家登出 + 玩家改密

**Files:**
- Modify: `packages-game/game-server/src/constants/error-codes.ts:17`
- Create: `packages-game/game-server/src/modules/auth/dto/password.dto.ts`
- Modify: `packages-game/game-server/src/modules/auth/auth.service.ts`
- Modify: `packages-game/game-server/src/modules/auth/auth.controller.ts`
- Test: `packages-game/game-server/src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: 写失败的测试**

在 `packages-game/game-server/src/modules/auth/auth.service.spec.ts` 末尾（`describe` 内）追加：

```ts
  it('should bump tokenVersion on logout', async () => {
    mockAccountRepo.findOne.mockResolvedValue({ id: '2', tokenVersion: 1 });

    await expect(service.logout('2')).resolves.toEqual({ ok: true });
    expect(mockAccountRepo.update).toHaveBeenCalledWith(
      { id: '2' },
      { tokenVersion: 2 },
    );
  });

  it('should throw on logout when account not found', async () => {
    mockAccountRepo.findOne.mockResolvedValue(null);
    await expect(service.logout('2')).rejects.toThrow(GameException);
  });

  it('should throw on logout when accountId is not numeric', async () => {
    await expect(service.logout('abc')).rejects.toThrow(GameException);
    expect(mockAccountRepo.findOne).not.toHaveBeenCalled();
  });

  it('should reject password change for SSO accounts', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '2',
      accountType: AccountType.SSO,
      passwordHash: 'hash',
      tokenVersion: 0,
    });

    await expect(
      service.changePassword('2', 'oldpass123', 'newpass123'),
    ).rejects.toThrow(GameException);
    expect(mockAccountRepo.update).not.toHaveBeenCalled();
  });

  it('should throw when old password is wrong on changePassword', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '2',
      accountType: AccountType.NORMAL,
      passwordHash: 'hash',
      tokenVersion: 0,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(false);

    await expect(
      service.changePassword('2', 'wrong', 'newpass123'),
    ).rejects.toThrow(GameException);
    expect(mockAccountRepo.update).not.toHaveBeenCalled();
  });

  it('should update password hash and bump tokenVersion on changePassword', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      id: '2',
      accountType: AccountType.NORMAL,
      passwordHash: 'hash',
      tokenVersion: 3,
    });
    jest.spyOn(service as any, 'comparePassword').mockResolvedValue(true);

    await expect(
      service.changePassword('2', 'oldpass123', 'newpass123'),
    ).resolves.toEqual({ ok: true });

    expect(mockAccountRepo.update).toHaveBeenCalledTimes(1);
    const [criteria, patch] = mockAccountRepo.update.mock.calls[0];
    expect(criteria).toEqual({ id: '2' });
    expect(patch.tokenVersion).toBe(4);
    expect(typeof patch.passwordHash).toBe('string');
    expect(patch.passwordHash).not.toBe('hash');
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- auth.service.spec
```

Expected: FAIL —— `service.logout is not a function`。

- [ ] **Step 3: 加错误码**

编辑 `packages-game/game-server/src/constants/error-codes.ts`，在 `ADMIN_INACTIVE: 10013,` 之后追加：

```ts
  PASSWORD_CHANGE_NOT_ALLOWED: 10014,
```

- [ ] **Step 4: 实现两个方法**

编辑 `packages-game/game-server/src/modules/auth/auth.service.ts`，在 `private generateToken(` 之前插入：

```ts
  async logout(accountId: string): Promise<{ ok: true }> {
    if (!/^\d+$/.test(accountId)) {
      throw new GameException(ErrorCodes.ACCOUNT_NOT_FOUND, '账号不存在');
    }
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });
    if (!account) {
      throw new GameException(ErrorCodes.ACCOUNT_NOT_FOUND, '账号不存在');
    }
    await this.accountRepo.update(
      { id: account.id },
      { tokenVersion: account.tokenVersion + 1 },
    );
    return { ok: true };
  }

  async changePassword(
    accountId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    if (!/^\d+$/.test(accountId)) {
      throw new GameException(ErrorCodes.ACCOUNT_NOT_FOUND, '账号不存在');
    }
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });
    if (!account) {
      throw new GameException(ErrorCodes.ACCOUNT_NOT_FOUND, '账号不存在');
    }
    if (account.accountType === AccountType.SSO) {
      throw new GameException(
        ErrorCodes.PASSWORD_CHANGE_NOT_ALLOWED,
        'SSO 账号无本地密码，不支持修改',
      );
    }
    const isOldValid = await this.comparePassword(
      oldPassword,
      account.passwordHash,
    );
    if (!isOldValid) {
      throw new GameException(ErrorCodes.ACCOUNT_PASSWORD_WRONG, '原密码错误');
    }
    const passwordHash = await this.hashPassword(newPassword);
    await this.accountRepo.update(
      { id: account.id },
      { passwordHash, tokenVersion: account.tokenVersion + 1 },
    );
    return { ok: true };
  }

```

说明：`AccountType` 已在文件头部 import（第 15 行），无需新增 import。

- [ ] **Step 5: 创建 DTO**

创建 `packages-game/game-server/src/modules/auth/dto/password.dto.ts`：

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  oldPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword: string;
}
```

- [ ] **Step 6: 加控制器路由**

编辑 `packages-game/game-server/src/modules/auth/auth.controller.ts`：

（1）import 区追加一行：

```ts
import { ChangePasswordDto } from './dto/password.dto';
```

（2）在 `anti-addiction` 路由之后追加：

```ts
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiOperation({ summary: '登出（使该账号全部端 token 失效）' })
  async logout(@CurrentPlayer() player: CurrentPlayerData) {
    return this.authService.logout(player.accountId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('password')
  @ApiOperation({ summary: '修改密码（改后需重新登录）' })
  async changePassword(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      player.accountId,
      dto.oldPassword,
      dto.newPassword,
    );
  }
```

路由结果为 `POST /api/client/v1/auth/logout`、`POST /api/client/v1/auth/password`。

- [ ] **Step 7: 跑测试确认通过**

```bash
npm test -- auth.service.spec
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add packages-game/game-server/src/constants/error-codes.ts packages-game/game-server/src/modules/auth/dto/password.dto.ts packages-game/game-server/src/modules/auth/auth.service.ts packages-game/game-server/src/modules/auth/auth.service.spec.ts packages-game/game-server/src/modules/auth/auth.controller.ts
git commit -m "feat(auth): P0-B T5 玩家登出与改密接口"
```

---

## Task 6: GM 踢玩家下线

**Files:**
- Modify: `packages-game/game-server/src/modules/auth/auth-admin.controller.ts`
- Test: `packages-game/game-server/src/modules/auth/auth-admin.controller.spec.ts`

- [ ] **Step 1: 写失败的测试**

创建 `packages-game/game-server/src/modules/auth/auth-admin.controller.spec.ts`：

```ts
import { Test } from '@nestjs/testing';
import { AuthAdminController } from './auth-admin.controller';
import { AuthService } from './auth.service';
import { AdminGuard } from '@common/guards/admin.guard';

const mockAuthService = {
  applyPenalty: jest.fn(),
  getPenalties: jest.fn(),
  logout: jest.fn().mockResolvedValue({ ok: true }),
};

describe('AuthAdminController', () => {
  let controller: AuthAdminController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.logout.mockResolvedValue({ ok: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthAdminController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AuthAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate kick to authService.logout', async () => {
    await expect(controller.kickPlayer('42')).resolves.toEqual({ ok: true });
    expect(mockAuthService.logout).toHaveBeenCalledWith('42');
  });
});
```

> **执行偏离（实测补充）**：类上的 `@UseGuards(AdminGuard)` 会让测试模块尝试解析 `AdminGuard` 的 4 个依赖（`JwtService` / `ConfigService` / `Reflector` / `AdminSessionService`），未提供时会直接 DI 失败，红阶段报的是 DI 错误而非「路由缺失」。故在测试模块上补 `.overrideGuard(AdminGuard).useValue({ canActivate: () => true })`，使红阶段回到验证「`kickPlayer` 路由不存在」。

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- auth-admin.controller.spec
```

Expected: FAIL —— `controller.kickPlayer is not a function`（已按上方偏离补 `overrideGuard`；`should be defined` 应 PASS）。

- [ ] **Step 3: 加路由**

编辑 `packages-game/game-server/src/modules/auth/auth-admin.controller.ts`，在 `getPenalties` 方法之后追加：

```ts
  @Post('players/:accountId/logout')
  @ApiOperation({ summary: 'GM 踢玩家下线（使该账号全部端 token 失效）' })
  async kickPlayer(@Param('accountId') accountId: string) {
    return this.authService.logout(accountId);
  }
```

路由结果为 `POST /api/admin/v1/auth/players/:accountId/logout`。该控制器已在类上声明 `@UseGuards(AdminGuard)` 与 `@Roles('super_admin', 'admin', 'operator')`，无需重复声明。`accountId` 的数字校验在 `AuthService.logout` 内（Task 5 Step 4），非数字返回 `ACCOUNT_NOT_FOUND` 而非 500。

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- auth-admin.controller.spec
```

Expected: PASS，2 个用例。

- [ ] **Step 5: 全量回归**

```bash
npm test
```

Expected: 全部 suite 通过，用例数 = 915 + 本计划新增（T1 新增 1 文件 6 例、T2 新增 1 文件 6 例、T4 +4 例、T5 +6 例、T6 新增 1 文件 2 例，共约 +24 例）。

- [ ] **Step 6: 编译校验**

```bash
npx tsc --noEmit
```

Expected: 0 error。

- [ ] **Step 7: 提交**

```bash
git add packages-game/game-server/src/modules/auth/auth-admin.controller.ts packages-game/game-server/src/modules/auth/auth-admin.controller.spec.ts
git commit -m "feat(auth): P0-B T6 GM 踢玩家下线接口"
```

---

## Task 7: 部署与冒烟

> 本 Task 会改动生产环境（`39.106.99.9` / `/opt/game-server`），**须用户确认后执行**。

**Files:**
- Create: `packages-game/game-server/scripts/smoke-p0b-auth.sh`

- [ ] **Step 1: 写冒烟脚本**

创建 `packages-game/game-server/scripts/smoke-p0b-auth.sh`：

```bash
#!/bin/bash
# P0-B 账号安全冒烟 · GM 过期/登出/改密 · 玩家登出 · GM 踢下线
# Run on odoo: ADMIN_PASS 自动来自 .env.prod
BASE=http://127.0.0.1:3000
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1 | body: $2"; }
field() { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
okbody() { echo "$1" | grep -q '"ok":true'; }

ADMIN_PASS=$(grep '^ADMIN_DEFAULT_PASSWORD=' /opt/game-server/.env.prod | cut -d= -f2-)
NOW=$(date +%s)

echo "== 1. GM login + exp 12h =="
LOGIN=$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")
GM=$(field "$LOGIN" token)
if [ -n "$GM" ]; then ok "GM login"; else bad "GM login" "$LOGIN"; exit 1; fi

EXP=$(echo "$GM" | cut -d. -f2 | tr '_-' '/+' \
  | awk '{ l=length($0)%4; if(l==2)$0=$0"=="; else if(l==3)$0=$0"="; print }' \
  | base64 -d 2>/dev/null | sed -n 's/.*"exp":\([0-9]*\).*/\1/p')
if [ -n "$EXP" ]; then
  DIFF=$((EXP - NOW))
  if [ "$DIFF" -gt 39600 ] && [ "$DIFF" -le 43200 ]; then ok "GM exp=${DIFF}s"; else bad "GM exp out of range" "$DIFF"; fi
else
  bad "GM token has no exp" "$LOGIN"
fi

S=$(status -H "Authorization: Bearer $GM" $BASE/api/admin/v1/notice/list)
if [ "$S" = "200" ]; then ok "admin api reachable"; else bad "admin api" "$S"; fi

echo "== 2. GM logout revokes token =="
LOGOUT=$(curl -s -X POST $BASE/api/admin/v1/logout -H "Authorization: Bearer $GM")
if okbody "$LOGOUT"; then ok "GM logout"; else bad "GM logout" "$LOGOUT"; fi
S=$(status -H "Authorization: Bearer $GM" $BASE/api/admin/v1/notice/list)
if [ "$S" = "401" ]; then ok "old GM token 401"; else bad "old GM token not revoked" "$S"; fi

echo "== 3. GM change password =="
GM2=$(field "$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")" token)
NEWPASS="${ADMIN_PASS}_tmp"
CH=$(curl -s -X POST $BASE/api/admin/v1/password -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $GM2" -d "{\"oldPassword\":\"$ADMIN_PASS\",\"newPassword\":\"$NEWPASS\"}")
if okbody "$CH"; then ok "GM change pwd"; else bad "GM change pwd" "$CH"; fi
S=$(status -H "Authorization: Bearer $GM2" $BASE/api/admin/v1/notice/list)
if [ "$S" = "401" ]; then ok "token revoked after pwd change"; else bad "token after pwd change" "$S"; fi

GM3=$(field "$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$NEWPASS\"}")" token)
if [ -n "$GM3" ]; then ok "login with new password"; else bad "login with new password" "empty token"; fi

RESTORE=$(curl -s -X POST $BASE/api/admin/v1/password -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $GM3" -d "{\"oldPassword\":\"$NEWPASS\",\"newPassword\":\"$ADMIN_PASS\"}")
if okbody "$RESTORE"; then ok "password restored"; else bad "password restored" "$RESTORE"; fi
GM3=$(field "$(curl -s -X POST $BASE/api/admin/v1/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}")" token)
if [ -n "$GM3" ]; then ok "login with original password"; else bad "original password unusable" "empty token"; fi

echo "== 4. player guest logout =="
GUEST=$(curl -s -X POST $BASE/api/client/v1/auth/guest)
GT=$(field "$GUEST" token)
if [ -n "$GT" ]; then ok "guest login"; else bad "guest login" "$GUEST"; exit 1; fi
S=$(status -H "Authorization: Bearer $GT" $BASE/api/client/v1/auth/security-status)
if [ "$S" = "200" ]; then ok "client api reachable"; else bad "client api" "$S"; fi

S=$(status -X POST -H "Authorization: Bearer $GT" $BASE/api/client/v1/auth/logout)
if [ "$S" = "200" ]; then ok "player logout"; else bad "player logout" "$S"; fi
S=$(status -H "Authorization: Bearer $GT" $BASE/api/client/v1/auth/security-status)
if [ "$S" = "401" ]; then ok "player token 401 after logout"; else bad "player token not revoked" "$S"; fi

echo "== 5. GM kick player offline =="
GUEST=$(curl -s -X POST $BASE/api/client/v1/auth/guest)
GT=$(field "$GUEST" token)
GACC=$(field "$GUEST" accountId)
if [ -n "$GT" ] && [ -n "$GACC" ]; then ok "guest login acc=$GACC"; else bad "guest login" "$GUEST"; exit 1; fi
KICK=$(curl -s -X POST -H "Authorization: Bearer $GM3" $BASE/api/admin/v1/auth/players/$GACC/logout)
if okbody "$KICK"; then ok "GM kick"; else bad "GM kick" "$KICK"; fi
S=$(status -H "Authorization: Bearer $GT" $BASE/api/client/v1/auth/security-status)
if [ "$S" = "401" ]; then ok "kicked token 401"; else bad "kicked token not revoked" "$S"; fi

echo "== result: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" = "0" ] || exit 1
```

脚本要点：

- 成功响应是纯业务对象（如 `{"ok":true}`），失败才带 `"code"`；而 `GameException` 的 HTTP 状态同样是 200（[game.exception.ts:15](file:///e:/code/nest/packages-game/game-server/src/common/exceptions/game.exception.ts#L15)），故成功判定用 `grep '"ok":true'`，凭证失效判定用 HTTP 401。
- `guest` 账号密码是随机 UUID，无法用于改密，故**玩家改密**只能用手工注册号验证（`register` 限流 5 次/60s，不放进冒烟脚本）。
- 每次运行都会把 admin 密码改为 `_tmp` 再改回；若中途中断，需用 `_tmp` 后缀密码登录并改回。

- [ ] **Step 2: 生产库加列**

```bash
ssh odoo "docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -c 'ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0;'"
ssh odoo "docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -c '\d admin_users'"
```

Expected: 第二条能列出 `token_version | integer | not null default 0`。

- [ ] **Step 3: 本地构建并打包**

```bash
npm run build
tar -czf dist-p0b.tar.gz -C dist .
```

（在 `e:\code\nest\packages-game\game-server` 下执行；`-C` 必须用实际路径，避免相对链 `chdir` 失败产生 0 字节包。）

- [ ] **Step 4: 上传并替换 dist**

```bash
scp dist-p0b.tar.gz odoo:/tmp/
ssh odoo "cd /opt/game-server && BK=dist_prev_\$(date +%Y%m%d_%H%M%S) && cp -r dist \$BK && echo \"backup=\$BK\" && rm -rf dist && mkdir dist && tar -xzf /tmp/dist-p0b.tar.gz -C dist"
```

**记录输出的 `backup=dist_prev_xxxx` 值**，Step 7 回滚要用。服务器时钟偏慢，`tar` 的 future timestamp 警告无害。

- [ ] **Step 5: 重启并查日志**

```bash
ssh odoo "systemctl restart game-server && sleep 8 && systemctl is-active game-server && journalctl -u game-server --since '-30 sec' --no-pager | tail -20"
```

Expected: `active`，日志出现 `Nest application successfully started`，无 error。

- [ ] **Step 6: 跑冒烟**

```bash
scp scripts/smoke-p0b-auth.sh odoo:/tmp/
ssh odoo "chmod +x /tmp/smoke-p0b-auth.sh && /tmp/smoke-p0b-auth.sh"
```

Expected: 全部 PASS，最后输出 `result: PASS=15 FAIL=0`。

- [ ] **Step 7: 回滚（仅失败时）**

把 `$BK` 换成 Step 4 记录的实际备份目录名：

```bash
ssh odoo "cd /opt/game-server && rm -rf dist && cp -r dist_prev_20260921_120000 dist && systemctl restart game-server && systemctl is-active game-server"
ssh odoo "docker exec 1Panel-postgresql-4LsS psql -U game -d game_server -c 'ALTER TABLE admin_users DROP COLUMN IF EXISTS token_version;'"
```

- [ ] **Step 8: 提交脚本**

```bash
git add packages-game/game-server/scripts/smoke-p0b-auth.sh
git commit -m "chore(auth): P0-B T7 账号安全冒烟脚本"
```

- [ ] **Step 9: 同步盘点报告进度**

编辑 `docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md`：

（1）P0 表中 `P0-5` / `P0-6` 两行的「项」列追加「（已修复）」；
（2）P0 表下方的「修复进度」段落补充：P0-5、P0-6 已修复，提交列表与本计划文件名；部署与冒烟结果一并写入。

```bash
git add docs/superpowers/specs/2026-09-20-game-server-completeness-inventory-design.md
git commit -m "docs: P0-B 完成后同步盘点报告进度"
```

---

## 完成验收

全部任务完成后应满足：

1. `npm test` 全绿；`npx tsc --noEmit` 0 error；`npm run build` 成功。
2. GM 登录返回的 token 解出 `exp` 且剩余有效期 ≈ 12h。
3. GM 调 `POST /api/admin/v1/logout` 或改密后，原 token 调任意 `api/admin/v1/*` 返回 401。
4. 玩家调 `POST /api/client/v1/auth/logout` 后，原 token 调需鉴权的 `api/client/v1/*` 返回 401。
5. GM 调 `POST /api/admin/v1/auth/players/:accountId/logout` 后，目标账号的全部 token 失效。
6. SSO 账号调改密返回 `PASSWORD_CHANGE_NOT_ALLOWED`，不返回 500。

## 风险与回滚

| 风险 | 影响 | 处置 |
|---|---|---|
| 上线后存量 GM token 全部失效 | GM 需重新登录一次 | 预期行为。`AdminJwtPayload` 新增必填 `tokenVersion`，旧 token 无该字段 → 校验不通过。提前告知运营 |
| GM token 每 12h 过期 | GM 可能在操作中被打断回登录页 | 前端已有 401 兜底（[index.html:462](file:///e:/code/nest/packages-game/game-server/admin/index.html#L462)）；如需调长，改环境变量 `JWT_ADMIN_EXPIRES_IN` 重启即可，无需改代码 |
| `AdminGuard` 每次 GM 请求多 1 次 DB 查询 | GM 后台为低频管理端，影响可忽略 | 无需缓存；若后续成为瓶颈，再引入短 TTL 缓存 |
| `admin_users` 加列失败或遗漏 | `AdminSessionService` 查 `token_version` 报列不存在 → 所有 GM 接口 500 | 必须按 Task 7 Step 2 先加列再替换 dist；回滚见 Step 7 |
| `@Global` 的 `AdminSessionModule` 引入循环依赖 | 应用启动即失败 | 已在设计决策 4 用 `import type` 规避；Task 6 Step 5 全量测试与启动日志可验证 |

## 不在本次范围

- 多端会话列表（需要管理端登录日志表与 IP/UA 记录）
- GM 后台面板 UI（P0-8）
- refresh token / 自动续期
- 管理动作审计事件（归 P0-8 统一处理）
- 其余 P0：P0-4 配置字段生效、P0-7 交易经济、P0-8 GM 后台面板

---

## 执行记录（Task 1-6 已完成）

按用户选择「先做 Task 1-6，部署后议」，Task 7 生产部署**未执行**。执行方式：子代理驱动，每个 Task 一个子代理，主代理逐 commit `git show` 核对 diff 与计划一致、且只动计划内文件。

| 提交 | 内容 | 文件 |
|---|---|---|
| `48bc54ffc` | Task 1：`token_version` 列 + `AdminSessionService` + 全局模块 | 5 files，+124 |
| `6422151c1` | Task 2：`AdminGuard` 异步化 + 会话校验 | 3 files，+107 −1 |
| `aebcfe8be` | Task 3：GM token 12h 过期 | 4 files，+26 −4 |
| `a6b4de9fd` | Task 4：GM 登出 + GM 改密 | 4 files，+130 −3 |
| `2f15e664f` | Task 5：玩家登出 + 玩家改密 | 5 files，+160 |
| `457aedad4` | Task 5 用例归位到独立 `describe('登出与改密')` | 1 file，+31 |
| `4589895ef` | Task 6：GM 踢玩家下线 | 2 files，+42 |
| `bfcdb09c5` | Task 2 回归修复：3 个既有 controller spec 补 `AdminSessionService` provider | 3 files，+15 |

**测试账目**：77 suites / 915 tests → **80 suites / 939 tests 全绿**（+3 suites / +24 tests，与计划预估 6+6+4+6+2 一致）；`npx tsc --noEmit` = 0 error。

**其他执行偏离（不改变设计，仅记录）**：

1. Task 3 计划写「4 个用例」实为 5 个（漏算 `should be defined`）；Task 4 计划写「8 个」实为 9 个；Task 2 计划预告 2 例失败实际 6 例全失败（同步 `canActivate` 返回 boolean 使 `rejects`/`resolves` 匹配器直接报类型错误）。计数误差，功能与断言无误。
2. Task 5 的 6 个新用例被子代理落进 `describe('SSO 登录')` 块，按该文件「一个功能域一个 describe、各自带 setup」的既有约定新建 `describe('登出与改密')` 归位（提交 `457aedad4`），37 tests 仍全绿。