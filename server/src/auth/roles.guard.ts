import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleCode } from '@prisma/client';
import type { AuthenticatedRequest } from './auth.types.js';
import { ROLES_KEY } from './roles.constants.js';

/**
 * Allows the request when the user has at least one of the roles listed by
 * @Auth(...). No role is a superuser: ADMIN only passes where ADMIN is listed.
 * Must run after JwtAuthGuard (use @Auth(), which wires both in order).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleCode[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException();

    if (!required.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
