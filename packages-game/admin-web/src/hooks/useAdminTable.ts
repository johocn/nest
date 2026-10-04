import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAdminTableReturn<T> {
  data: T[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  error: Error | null;
  setPage: (p: number) => void;
  setPageSize: (s: number) => void;
  reload: () => void;
}

export interface UseAdminTableOptions {
  defaultPage?: number;
  defaultPageSize?: number;
  immediate?: boolean;
  /** 依赖项变更时自动 reload（类似 useEffect deps） */
  deps?: React.DependencyList;
}

/**
 * 统一处理分页列表请求的 hook。
 * 自动解包后端信封 {code:0, data:{items,total}} 或 {code:0, data:[...]}
 * 传入的 fetchFn 签名：(page, pageSize) => Promise<any>
 */
export function useAdminTable<T = any>(
  fetchFn: (page: number, pageSize: number) => Promise<any>,
  options: UseAdminTableOptions = {},
): UseAdminTableReturn<T> {
  const { defaultPage = 1, defaultPageSize = 20, immediate = true, deps = [] } = options;

  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(defaultPage);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [error, setError] = useState<Error | null>(null);

  // 最新 fetchFn 引用（避免闭包问题）
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const load = useCallback(
    async (p: number, s: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchRef.current(p, s);
        // client.ts 拦截器没解信封，所以 axios res.data 才是后端信封 {code,msg,data}
        const envelope = res?.data ?? res;
        const body = envelope?.code === 0 ? envelope.data : envelope;

        if (body && Array.isArray(body)) {
          setData(body as T[]);
          setTotal(body.length);
        } else if (body && typeof body === 'object') {
          const list = (body.items ?? body.list ?? body.rows) as T[] | undefined;
          const count = (body.total ?? body.count) as number | undefined;
          setData(Array.isArray(list) ? list : []);
          setTotal(typeof count === 'number' ? count : (Array.isArray(list) ? list.length : 0));
        } else {
          setData([]);
          setTotal(0);
        }
      } catch (e: any) {
        setError(e instanceof Error ? e : new Error(e?.message || '请求失败'));
        setData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    // deps 由 useEffect 统一管理，这里只依赖 fetchRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const reload = useCallback(() => {
    load(page, pageSize);
  }, [load, page, pageSize]);

  useEffect(() => {
    if (immediate) {
      load(page, pageSize);
    }
    // 允许外部 deps 触发 reload（比如筛选条件变化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, ...deps]);

  return {
    data,
    total,
    loading,
    page,
    pageSize,
    error,
    setPage,
    setPageSize,
    reload,
  };
}
