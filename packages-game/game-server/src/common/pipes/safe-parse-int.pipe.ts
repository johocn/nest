import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class SafeParseIntPipe implements PipeTransform<
  string | number,
  number
> {
  constructor(
    private readonly defaultValue?: number,
    private readonly min?: number,
    private readonly max?: number,
  ) {}

  transform(value: string | number): number {
    if (value === undefined || value === null || value === '') {
      if (this.defaultValue !== undefined) return this.defaultValue;
      throw new BadRequestException('参数缺失');
    }
    const num = Number(value);
    if (isNaN(num)) {
      if (this.defaultValue !== undefined) return this.defaultValue;
      throw new BadRequestException('参数必须为数字');
    }
    if (this.min !== undefined && num < this.min) return this.min;
    if (this.max !== undefined && num > this.max) return this.max;
    return Math.floor(num);
  }
}
