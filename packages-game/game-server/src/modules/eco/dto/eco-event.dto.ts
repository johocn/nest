import { IsString, IsObject, IsOptional } from 'class-validator';

export const ECO_ACTIONS = [
  'view_article',
  'view_course',
  'view_product',
  'view_price',
  'view_activity',
  'join_activity',
  'like',
  'comment',
  'purchase',
  'distribute',
] as const;

export type EcoAction = (typeof ECO_ACTIONS)[number];

export class EcoEventDto {
  @IsString()
  action: string;

  @IsString()
  scope: string;

  @IsString()
  ssoId: string;

  @IsString()
  targetId: string;

  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}
