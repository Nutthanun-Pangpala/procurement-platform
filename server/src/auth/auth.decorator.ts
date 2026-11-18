import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { RoleCode } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { ROLES_KEY } from './roles.constants.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Protects a route or controller.
 *   @Auth()                          any logged-in user
 *   @Auth('PROCUREMENT')             PROCUREMENT only
 *   @Auth('PROCUREMENT', 'APPROVER') either role
 * The module that uses it must import AuthModule (it provides JwtService).
 */
export const Auth = (...roles: RoleCode[]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(JwtAuthGuard, RolesGuard),
  );
