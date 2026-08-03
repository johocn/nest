export interface PaginationResult<T> {
  items: T[];
  total: number;
}

export interface PaginationQuery {
  page: number;
  limit: number;
}
