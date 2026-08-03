export interface WsRequest<T = any> {
  cmd: string;
  seq: number;
  data: T;
}

export interface WsResponse<T = any> {
  cmd: string;
  seq: number;
  code: number;
  msg: string;
  data: T;
}
