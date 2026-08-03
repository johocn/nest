import { PipeTransform, Injectable } from '@nestjs/common';

export interface PaginationParams {
  page: number;
  limit: number;
}

@Injectable()
export class ValidatePaginationPipe implements PipeTransform<
  any,
  PaginationParams
> {
  transform(value: any): PaginationParams {
    let page = Number(value?.page) || 1;
    let limit = Number(value?.limit) || 20;
    if (page < 1) page = 1;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;
    return { page: Math.floor(page), limit: Math.floor(limit) };
  }
}
