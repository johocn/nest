import { Button, Empty, Space, Table, TableProps } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useAdminTable } from '../hooks/useAdminTable';

export interface AdminTableProps<T = any>
  extends Omit<TableProps<T>, 'dataSource' | 'loading' | 'pagination' | 'rowKey' | 'title'> {
  fetchFn: (page: number, pageSize: number) => Promise<any>;
  rowKey: string | ((record: T) => string | number);
  title?: React.ReactNode;
  /** 表格右上方、刷新按钮左侧的额外内容（筛选器、新建按钮等） */
  extra?: React.ReactNode;
  defaultPageSize?: number;
  deps?: React.DependencyList;
}

/**
 * 薄封装 AntD Table：内置 useAdminTable 分页、右上刷新按钮、空态 Empty。
 */
export default function AdminTable<T extends object = any>(props: AdminTableProps<T>) {
  const {
    fetchFn,
    rowKey,
    title,
    extra,
    defaultPageSize = 20,
    deps = [],
    columns,
    ...rest
  } = props;

  const { data, total, loading, page, pageSize, setPage, setPageSize, reload } = useAdminTable<T>(
    fetchFn,
    { defaultPageSize, deps },
  );

  return (
    <Table<T>
      rowKey={rowKey}
      columns={columns}
      dataSource={data}
      loading={loading}
      title={
        title || extra || !!(props as any).fetchFn
          ? () => (
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <span>{title}</span>
                <Space>
                  {extra}
                  <Button icon={<ReloadOutlined />} onClick={reload}>
                    刷新
                  </Button>
                </Space>
              </Space>
            )
          : undefined
      }
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        showQuickJumper: true,
        showTotal: (t) => `共 ${t} 条`,
        onChange: (p, s) => {
          setPage(p);
          setPageSize(s);
        },
      }}
      locale={{
        emptyText: <Empty description="暂无数据" />,
      }}
      {...rest}
    />
  );
}
