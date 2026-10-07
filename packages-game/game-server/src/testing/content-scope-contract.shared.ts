import { type FindOperator } from 'typeorm';
import { COMMON_SCOPE } from '@shared/content-scope';

/**
 * 契约断言：mock repo 的 find/findOne/findAndCount 首参 where 必须携带 appScope 过滤。
 * 每张内容表的 service spec 在覆盖其查询方法的用例末尾调用本函数——
 * 漏写 visibleTo 展开即 CI 红灯（spec 第 4 节第 4 层防线的单测级实现）。
 */
export function expectScopedFind(
  repoMock: jest.Mock,
  expectedApps: string[] = [COMMON_SCOPE],
): void {
  const call = repoMock.mock.calls[0]?.[0] as
    | { where?: Record<string, unknown> }
    | Array<{ where?: Record<string, unknown> }>
    | undefined;
  const first = Array.isArray(call) ? call[0] : call;
  const scope = first?.where?.appScope as FindOperator<string> | undefined;
  if (!scope || !Array.isArray(scope.value)) {
    throw new Error(
      `where 缺少 appScope 过滤：查询必须展开 visibleTo(appCode)（expected ${expectedApps.join('/')}）`,
    );
  }
  expect(scope.value).toEqual(expectedApps);
}
