import { SetMetadata } from '@nestjs/common';
import { ADMIN_ROLES_KEY } from '@common/guards/admin.guard';

export const Roles = (...roles: string[]) => SetMetadata(ADMIN_ROLES_KEY, roles);
